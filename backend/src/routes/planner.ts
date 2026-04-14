import { Router, Request, Response } from 'express';
import { query, queryOne, pool } from '../db';
import { generateWeekPlan, getUserProfile } from '../services/suggestionEngine';
import { generateShoppingList } from '../services/shoppingListGenerator';

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawPlan {
  id: number;
  name: string;
  week_start: string;
  created_at: Date;
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
  dietary_tags: string[];
  ingredients: unknown[];
  instructions: string[];
  rating: number | null;
  notes: string;
  is_custom: boolean;
  created_at: Date;
}

function serializePlan(raw: RawPlan) {
  return {
    ...raw,
    week_start: String(raw.week_start).substring(0, 10), // pg returns DATE as string
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : String(raw.created_at),
  };
}

function serializeRecipe(raw: RawRecipe) {
  return {
    ...raw,
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : String(raw.created_at),
  };
}

async function enrichSlots(rawSlots: RawSlot[]) {
  return Promise.all(rawSlots.map(async (slot) => {
    const recipe = await queryOne<RawRecipe>('SELECT * FROM recipes WHERE id = $1', [slot.recipe_id]);
    return { ...slot, recipe: recipe ? serializeRecipe(recipe) : null };
  }));
}

function getMondayOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().substring(0, 10);
}

// ─── GET /api/plans ───────────────────────────────────────────────────────────

router.get('/', async (_req: Request, res: Response) => {
  try {
    const plans = await query<RawPlan>('SELECT * FROM week_plans ORDER BY created_at DESC');
    res.json(plans.map(serializePlan));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/plans ──────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, week_start } = req.body as { name?: string; week_start?: string };
    const planName = name || `Wochenplan ${new Date().toLocaleDateString('de-DE')}`;
    const weekStart = week_start || getMondayOfCurrentWeek();

    const [created] = await query<RawPlan>(
      'INSERT INTO week_plans (name, week_start) VALUES ($1, $2) RETURNING *',
      [planName, weekStart],
    );
    res.status(201).json(serializePlan(created));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/plans/:id ───────────────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const plan = await queryOne<RawPlan>('SELECT * FROM week_plans WHERE id = $1', [req.params['id']]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const rawSlots = await query<RawSlot>(
      'SELECT * FROM meal_slots WHERE plan_id = $1 ORDER BY day, meal_type',
      [req.params['id']],
    );
    const slots = await enrichSlots(rawSlots);
    res.json({ ...serializePlan(plan), slots });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── PUT /api/plans/:id ───────────────────────────────────────────────────────

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const plan = await queryOne<RawPlan>('SELECT * FROM week_plans WHERE id = $1', [req.params['id']]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const { name = plan.name, week_start = plan.week_start } = req.body as { name?: string; week_start?: string };
    const [updated] = await query<RawPlan>(
      'UPDATE week_plans SET name=$1, week_start=$2 WHERE id=$3 RETURNING *',
      [name, week_start, req.params['id']],
    );
    res.json(serializePlan(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── DELETE /api/plans/:id ────────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const plan = await queryOne<{ id: number }>('SELECT id FROM week_plans WHERE id = $1', [req.params['id']]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    await query('DELETE FROM week_plans WHERE id = $1', [req.params['id']]);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/plans/:id/generate ────────────────────────────────────────────

router.post('/:id/generate', async (req: Request, res: Response) => {
  try {
    const plan = await queryOne<RawPlan>('SELECT * FROM week_plans WHERE id = $1', [req.params['id']]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const profileId = parseInt(String(req.body?.['profileId'] || '1'), 10);
    const planId = parseInt(req.params['id'], 10);

    await query('DELETE FROM meal_slots WHERE plan_id = $1', [planId]);

    const slots = await generateWeekPlan(profileId);

    // Use a client for the transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const slot of slots) {
        await client.query(
          'INSERT INTO meal_slots (plan_id, day, meal_type, recipe_id) VALUES ($1,$2,$3,$4)',
          [planId, slot.day, slot.meal_type, slot.recipe_id],
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const rawSlots = await query<RawSlot>(
      'SELECT * FROM meal_slots WHERE plan_id = $1 ORDER BY day, meal_type', [planId],
    );
    const enrichedSlots = await enrichSlots(rawSlots);
    res.json({ ...serializePlan(plan), slots: enrichedSlots });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/plans/:id/slots ─────────────────────────────────────────────────

router.get('/:id/slots', async (req: Request, res: Response) => {
  try {
    const plan = await queryOne<{ id: number }>('SELECT id FROM week_plans WHERE id = $1', [req.params['id']]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const rawSlots = await query<RawSlot>(
      'SELECT * FROM meal_slots WHERE plan_id = $1 ORDER BY day, meal_type',
      [req.params['id']],
    );
    res.json(await enrichSlots(rawSlots));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/plans/:id/slots ────────────────────────────────────────────────

router.post('/:id/slots', async (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params['id'], 10);
    const plan = await queryOne<{ id: number }>('SELECT id FROM week_plans WHERE id = $1', [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const { day, meal_type, recipe_id } = req.body as { day?: number; meal_type?: string; recipe_id?: number };

    if (day === undefined || !meal_type || !recipe_id) {
      return res.status(400).json({ error: 'day, meal_type, and recipe_id are required' });
    }
    if (day < 0 || day > 6) return res.status(400).json({ error: 'day must be between 0 and 6' });

    const validMealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
    if (!validMealTypes.includes(meal_type)) {
      return res.status(400).json({ error: `meal_type must be one of: ${validMealTypes.join(', ')}` });
    }

    const recipe = await queryOne<{ id: number }>('SELECT id FROM recipes WHERE id = $1', [recipe_id]);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    const existing = await queryOne<{ id: number }>(
      'SELECT id FROM meal_slots WHERE plan_id=$1 AND day=$2 AND meal_type=$3',
      [planId, day, meal_type],
    );

    let slot: RawSlot;
    if (existing) {
      const [updated] = await query<RawSlot>(
        'UPDATE meal_slots SET recipe_id=$1 WHERE id=$2 RETURNING *',
        [recipe_id, existing.id],
      );
      slot = updated;
    } else {
      const [inserted] = await query<RawSlot>(
        'INSERT INTO meal_slots (plan_id, day, meal_type, recipe_id) VALUES ($1,$2,$3,$4) RETURNING *',
        [planId, day, meal_type, recipe_id],
      );
      slot = inserted;
    }

    const recipeData = await queryOne<RawRecipe>('SELECT * FROM recipes WHERE id = $1', [slot.recipe_id]);
    res.status(existing ? 200 : 201).json({
      ...slot,
      recipe: recipeData ? serializeRecipe(recipeData) : null,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── DELETE /api/plans/:id/slots/:slotId ─────────────────────────────────────

router.delete('/:id/slots/:slotId', async (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params['id'], 10);
    const slotId = parseInt(req.params['slotId'], 10);

    const slot = await queryOne<{ id: number }>(
      'SELECT id FROM meal_slots WHERE id=$1 AND plan_id=$2', [slotId, planId],
    );
    if (!slot) return res.status(404).json({ error: 'Slot not found' });

    await query('DELETE FROM meal_slots WHERE id = $1', [slotId]);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/plans/:id/shopping ─────────────────────────────────────────────

router.get('/:id/shopping', async (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params['id'], 10);
    const plan = await queryOne<{ id: number }>('SELECT id FROM week_plans WHERE id = $1', [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const profile = await getUserProfile(1);
    const hidePantry = req.query['hidePantry'] !== 'false';
    const householdSize = parseInt(String(req.query['householdSize'] || profile.household_size), 10);

    const list = await generateShoppingList(planId, householdSize, hidePantry, profile.pantry_staples, profile.owned_ingredients);
    res.json(list);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/plans/:id/ical ──────────────────────────────────────────────────

router.get('/:id/ical', async (req: Request, res: Response) => {
  try {
    const planId = parseInt(req.params['id'], 10);
    const plan = await queryOne<RawPlan>('SELECT * FROM week_plans WHERE id = $1', [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const rawSlots = await query<RawSlot>(
      'SELECT * FROM meal_slots WHERE plan_id = $1 ORDER BY day, meal_type', [planId],
    );

    const weekStartStr = String(plan.week_start).substring(0, 10);
    const weekStart = new Date(weekStartStr + 'T00:00:00');

    const mealTypeToTime: Record<string, { hour: number; duration: number }> = {
      breakfast: { hour: 8, duration: 30 },
      lunch:     { hour: 12, duration: 60 },
      dinner:    { hour: 18, duration: 60 },
      snack:     { hour: 15, duration: 15 },
    };

    const formatIcalDate = (date: Date) =>
      date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

    const mealTypeLabels: Record<string, string> = {
      breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snack',
    };

    const lines: string[] = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'PRODID:-//MealMind//Meal Planner//DE',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${plan.name}`,
      'X-WR-TIMEZONE:Europe/Berlin',
    ];

    for (const slot of rawSlots) {
      const recipe = await queryOne<{ title: string }>('SELECT title FROM recipes WHERE id = $1', [slot.recipe_id]);
      if (!recipe) continue;

      const slotDate = new Date(weekStart);
      slotDate.setDate(weekStart.getDate() + slot.day);

      const timing = mealTypeToTime[slot.meal_type] || { hour: 12, duration: 30 };
      const dtStart = new Date(slotDate);
      dtStart.setHours(timing.hour, 0, 0, 0);
      const dtEnd = new Date(dtStart);
      dtEnd.setMinutes(dtStart.getMinutes() + timing.duration);

      lines.push(
        'BEGIN:VEVENT',
        `UID:mealmind-plan${planId}-slot${slot.id}@mealmind.app`,
        `DTSTART:${formatIcalDate(dtStart)}`,
        `DTEND:${formatIcalDate(dtEnd)}`,
        `SUMMARY:${mealTypeLabels[slot.meal_type] || slot.meal_type}: ${recipe.title}`,
        `DESCRIPTION:${recipe.title}`,
        `CATEGORIES:${mealTypeLabels[slot.meal_type] || slot.meal_type}`,
        'END:VEVENT',
      );
    }

    lines.push('END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mealmind-${planId}.ics"`);
    res.send(lines.join('\r\n'));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
