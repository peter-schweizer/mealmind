import { Router, Request, Response } from 'express';
import db from '../db';
import { generateWeekPlan, getUserProfile } from '../services/suggestionEngine';
import { generateShoppingList } from '../services/shoppingListGenerator';

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawPlan {
  id: number;
  name: string;
  week_start: string;
  created_at: string;
}

interface RawSlot {
  id: number;
  plan_id: number;
  day: number;
  meal_type: string;
  recipe_id: number;
}

interface RawRecipe {
  id: number;
  title: string;
  description: string;
  image_url: string;
  source_url: string;
  source_name: string;
  prep_time: number;
  cook_time: number;
  servings: number;
  dietary_tags: string;
  ingredients: string;
  instructions: string;
  rating: number | null;
  notes: string;
  is_custom: number;
  created_at: string;
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function parseRecipe(raw: RawRecipe) {
  return {
    ...raw,
    dietary_tags: safeJson<string[]>(raw.dietary_tags, []),
    ingredients: safeJson<unknown[]>(raw.ingredients, []),
    instructions: safeJson<string[]>(raw.instructions, []),
  };
}

function getMondayOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = (day === 0 ? -6 : 1 - day); // offset to Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().substring(0, 10); // YYYY-MM-DD
}

// ─── GET /api/plans ───────────────────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  try {
    const plans = db.prepare('SELECT * FROM week_plans ORDER BY created_at DESC').all() as unknown as RawPlan[];
    res.json(plans);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/plans ──────────────────────────────────────────────────────────

router.post('/', (req: Request, res: Response) => {
  try {
    const { name, week_start } = req.body as { name?: string; week_start?: string };
    const planName = name || `Wochenplan ${new Date().toLocaleDateString('de-DE')}`;
    const weekStart = week_start || getMondayOfCurrentWeek();

    const result = db.prepare(
      'INSERT INTO week_plans (name, week_start) VALUES (?, ?)',
    ).run(planName, weekStart);

    const created = db.prepare('SELECT * FROM week_plans WHERE id = ?').get(result.lastInsertRowid) as RawPlan;
    res.status(201).json(created);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/plans/:id ───────────────────────────────────────────────────────

router.get('/:id', (req: Request, res: Response) => {
  try {
    const plan = db.prepare('SELECT * FROM week_plans WHERE id = ?').get(req.params['id']) as RawPlan | undefined;
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const rawSlots = db.prepare('SELECT * FROM meal_slots WHERE plan_id = ? ORDER BY day, meal_type').all(req.params['id']) as RawSlot[];

    // Enrich slots with recipe data
    const slots = rawSlots.map(slot => {
      const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(slot.recipe_id) as RawRecipe | undefined;
      return {
        ...slot,
        recipe: recipe ? parseRecipe(recipe) : null,
      };
    });

    res.json({ ...plan, slots });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── PUT /api/plans/:id ───────────────────────────────────────────────────────

router.put('/:id', (req: Request, res: Response) => {
  try {
    const plan = db.prepare('SELECT * FROM week_plans WHERE id = ?').get(req.params['id']) as RawPlan | undefined;
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const { name = plan.name, week_start = plan.week_start } = req.body as { name?: string; week_start?: string };

    db.prepare('UPDATE week_plans SET name = ?, week_start = ? WHERE id = ?')
      .run(name, week_start, req.params['id']);

    const updated = db.prepare('SELECT * FROM week_plans WHERE id = ?').get(req.params['id']) as RawPlan;
    res.json(updated);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── DELETE /api/plans/:id ────────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const plan = db.prepare('SELECT id FROM week_plans WHERE id = ?').get(req.params['id']);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    // meal_slots are deleted by cascade
    db.prepare('DELETE FROM week_plans WHERE id = ?').run(req.params['id']);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/plans/:id/generate ────────────────────────────────────────────

router.post('/:id/generate', (req: Request, res: Response) => {
  try {
    const plan = db.prepare('SELECT * FROM week_plans WHERE id = ?').get(req.params['id']) as RawPlan | undefined;
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const profileId = parseInt(String(req.body?.['profileId'] || '1'), 10);
    const planId = parseInt(req.params['id'], 10);

    // Remove existing slots for this plan
    db.prepare('DELETE FROM meal_slots WHERE plan_id = ?').run(planId);

    // Generate new slots
    const slots = generateWeekPlan(profileId);

    const insertSlot = db.prepare(
      'INSERT INTO meal_slots (plan_id, day, meal_type, recipe_id) VALUES (?, ?, ?, ?)',
    );

    // node:sqlite has no .transaction() — use explicit BEGIN / COMMIT
    db.exec('BEGIN');
    try {
      for (const slot of slots) {
        insertSlot.run(planId, slot.day, slot.meal_type, slot.recipe_id);
      }
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    // Return plan with populated slots
    const rawSlots = db.prepare('SELECT * FROM meal_slots WHERE plan_id = ? ORDER BY day, meal_type').all(planId) as RawSlot[];
    const enrichedSlots = rawSlots.map(slot => {
      const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(slot.recipe_id) as RawRecipe | undefined;
      return { ...slot, recipe: recipe ? parseRecipe(recipe) : null };
    });

    res.json({ ...plan, slots: enrichedSlots });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/plans/:id/slots ─────────────────────────────────────────────────

router.get('/:id/slots', (req: Request, res: Response) => {
  try {
    const plan = db.prepare('SELECT id FROM week_plans WHERE id = ?').get(req.params['id']);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const rawSlots = db.prepare(
      'SELECT * FROM meal_slots WHERE plan_id = ? ORDER BY day, meal_type',
    ).all(req.params['id']) as RawSlot[];

    const enriched = rawSlots.map(slot => {
      const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(slot.recipe_id) as RawRecipe | undefined;
      return { ...slot, recipe: recipe ? parseRecipe(recipe) : null };
    });

    res.json(enriched);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/plans/:id/slots ────────────────────────────────────────────────
// Add or update a slot (upsert by plan_id + day + meal_type)

router.post('/:id/slots', (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params['id'], 10);
    const plan = db.prepare('SELECT id FROM week_plans WHERE id = ?').get(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const { day, meal_type, recipe_id } = req.body as {
      day?: number; meal_type?: string; recipe_id?: number;
    };

    if (day === undefined || !meal_type || !recipe_id) {
      return res.status(400).json({ error: 'day, meal_type, and recipe_id are required' });
    }

    if (day < 0 || day > 6) {
      return res.status(400).json({ error: 'day must be between 0 and 6' });
    }

    const validMealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
    if (!validMealTypes.includes(meal_type)) {
      return res.status(400).json({ error: `meal_type must be one of: ${validMealTypes.join(', ')}` });
    }

    // Verify recipe exists
    const recipe = db.prepare('SELECT id FROM recipes WHERE id = ?').get(recipe_id);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    // Check for existing slot
    const existing = db.prepare(
      'SELECT id FROM meal_slots WHERE plan_id = ? AND day = ? AND meal_type = ?',
    ).get(planId, day, meal_type) as { id: number } | undefined;

    let slotId: number;
    if (existing) {
      db.prepare('UPDATE meal_slots SET recipe_id = ? WHERE id = ?').run(recipe_id, existing.id);
      slotId = existing.id;
    } else {
      const result = db.prepare(
        'INSERT INTO meal_slots (plan_id, day, meal_type, recipe_id) VALUES (?, ?, ?, ?)',
      ).run(planId, day, meal_type, recipe_id);
      slotId = result.lastInsertRowid as number;
    }

    const slot = db.prepare('SELECT * FROM meal_slots WHERE id = ?').get(slotId) as RawSlot;
    const recipeData = db.prepare('SELECT * FROM recipes WHERE id = ?').get(slot.recipe_id) as RawRecipe | undefined;

    res.status(existing ? 200 : 201).json({
      ...slot,
      recipe: recipeData ? parseRecipe(recipeData) : null,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── DELETE /api/plans/:id/slots/:slotId ─────────────────────────────────────

router.delete('/:id/slots/:slotId', (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params['id'], 10);
    const slotId = parseInt(req.params['slotId'], 10);

    const slot = db.prepare(
      'SELECT id FROM meal_slots WHERE id = ? AND plan_id = ?',
    ).get(slotId, planId);

    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    db.prepare('DELETE FROM meal_slots WHERE id = ?').run(slotId);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/plans/:id/shopping ─────────────────────────────────────────────

router.get('/:id/shopping', (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params['id'], 10);
    const plan = db.prepare('SELECT id FROM week_plans WHERE id = ?').get(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const profile = getUserProfile(1);

    const hidePantry = req.query['hidePantry'] !== 'false'; // default true
    const householdSize = parseInt(String(req.query['householdSize'] || profile.household_size), 10);

    const list = generateShoppingList(
      planId,
      householdSize,
      hidePantry,
      profile.pantry_staples,
      profile.owned_ingredients,
    );

    res.json(list);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/plans/:id/ical ──────────────────────────────────────────────────

router.get('/:id/ical', (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params['id'], 10);
    const plan = db.prepare('SELECT * FROM week_plans WHERE id = ?').get(planId) as RawPlan | undefined;
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const rawSlots = db.prepare(
      'SELECT * FROM meal_slots WHERE plan_id = ? ORDER BY day, meal_type',
    ).all(planId) as RawSlot[];

    // Parse week_start as Monday
    const weekStart = new Date(plan.week_start + 'T00:00:00');

    const mealTypeToTime: Record<string, { hour: number; duration: number }> = {
      breakfast: { hour: 8, duration: 30 },
      lunch: { hour: 12, duration: 60 },
      dinner: { hour: 18, duration: 60 },
      snack: { hour: 15, duration: 15 },
    };

    const formatIcalDate = (date: Date): string => {
      return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    };

    const uid = (slot: RawSlot): string =>
      `mealmind-plan${planId}-slot${slot.id}@mealmind.app`;

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MealMind//Meal Planner//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${plan.name}`,
      'X-WR-TIMEZONE:Europe/Berlin',
    ];

    for (const slot of rawSlots) {
      const recipe = db.prepare('SELECT title FROM recipes WHERE id = ?').get(slot.recipe_id) as { title: string } | undefined;
      if (!recipe) continue;

      const slotDate = new Date(weekStart);
      slotDate.setDate(weekStart.getDate() + slot.day);

      const timing = mealTypeToTime[slot.meal_type] || { hour: 12, duration: 30 };

      const dtStart = new Date(slotDate);
      dtStart.setHours(timing.hour, 0, 0, 0);

      const dtEnd = new Date(dtStart);
      dtEnd.setMinutes(dtStart.getMinutes() + timing.duration);

      const mealTypeLabels: Record<string, string> = {
        breakfast: 'Frühstück',
        lunch: 'Mittagessen',
        dinner: 'Abendessen',
        snack: 'Snack',
      };

      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid(slot)}`,
        `DTSTART:${formatIcalDate(dtStart)}`,
        `DTEND:${formatIcalDate(dtEnd)}`,
        `SUMMARY:${mealTypeLabels[slot.meal_type] || slot.meal_type}: ${recipe.title}`,
        `DESCRIPTION:${recipe.title}`,
        `CATEGORIES:${mealTypeLabels[slot.meal_type] || slot.meal_type}`,
        'END:VEVENT',
      );
    }

    lines.push('END:VCALENDAR');

    const icsContent = lines.join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mealmind-${planId}.ics"`);
    res.send(icsContent);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
