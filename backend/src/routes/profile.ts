import { Router, Request, Response } from 'express';
import db from '../db';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface RawProfile {
  id: number;
  name: string;
  dietary_preferences: string;
  dislikes: string;
  allergies: string;
  household_size: number;
  pantry_staples: string;
  owned_ingredients: string;
}

function parseProfile(raw: RawProfile) {
  return {
    ...raw,
    dietary_preferences: safeJson<string[]>(raw.dietary_preferences, []),
    dislikes: safeJson<string[]>(raw.dislikes, []),
    allergies: safeJson<string[]>(raw.allergies, []),
    pantry_staples: safeJson<string[]>(raw.pantry_staples, []),
    owned_ingredients: safeJson<string[]>(raw.owned_ingredients, []),
  };
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

// ─── GET /api/profile ─────────────────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  try {
    const raw = db.prepare('SELECT * FROM user_profile WHERE id = 1').get() as RawProfile | undefined;
    if (!raw) return res.status(404).json({ error: 'Profile not found' });
    res.json(parseProfile(raw));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── PUT /api/profile ─────────────────────────────────────────────────────────

router.put('/', (req: Request, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM user_profile WHERE id = 1').get() as RawProfile | undefined;
    if (!existing) return res.status(404).json({ error: 'Profile not found' });

    const {
      name = existing.name,
      dietary_preferences,
      dislikes,
      allergies,
      household_size = existing.household_size,
      pantry_staples,
      owned_ingredients,
    } = req.body as Partial<{
      name: string;
      dietary_preferences: string[];
      dislikes: string[];
      allergies: string[];
      household_size: number;
      pantry_staples: string[];
      owned_ingredients: string[];
    }>;

    db.prepare(`
      UPDATE user_profile SET
        name = ?,
        dietary_preferences = ?,
        dislikes = ?,
        allergies = ?,
        household_size = ?,
        pantry_staples = ?,
        owned_ingredients = ?
      WHERE id = 1
    `).run(
      name,
      JSON.stringify(dietary_preferences ?? safeJson<string[]>(existing.dietary_preferences, [])),
      JSON.stringify(dislikes ?? safeJson<string[]>(existing.dislikes, [])),
      JSON.stringify(allergies ?? safeJson<string[]>(existing.allergies, [])),
      household_size,
      JSON.stringify(pantry_staples ?? safeJson<string[]>(existing.pantry_staples, [])),
      JSON.stringify(owned_ingredients ?? safeJson<string[]>(existing.owned_ingredients, [])),
    );

    const updated = db.prepare('SELECT * FROM user_profile WHERE id = 1').get() as RawProfile;
    res.json(parseProfile(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/profile/pantry ─────────────────────────────────────────────────
// Replace the pantry staples list

router.post('/pantry', (req: Request, res: Response) => {
  try {
    const { pantry_staples } = req.body as { pantry_staples?: string[] };
    if (!Array.isArray(pantry_staples)) {
      return res.status(400).json({ error: 'pantry_staples must be an array of strings' });
    }

    db.prepare('UPDATE user_profile SET pantry_staples = ? WHERE id = 1')
      .run(JSON.stringify(pantry_staples));

    const updated = db.prepare('SELECT * FROM user_profile WHERE id = 1').get() as RawProfile;
    res.json(parseProfile(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/profile/owned ──────────────────────────────────────────────────
// Toggle an ingredient in the owned_ingredients list

router.post('/owned', (req: Request, res: Response) => {
  try {
    const { ingredient } = req.body as { ingredient?: string };
    if (!ingredient) {
      return res.status(400).json({ error: 'ingredient is required' });
    }

    const raw = db.prepare('SELECT owned_ingredients FROM user_profile WHERE id = 1').get() as Pick<RawProfile, 'owned_ingredients'> | undefined;
    if (!raw) return res.status(404).json({ error: 'Profile not found' });

    const owned: string[] = safeJson<string[]>(raw.owned_ingredients, []);
    const idx = owned.findIndex(o => o.toLowerCase() === ingredient.toLowerCase());

    if (idx >= 0) {
      owned.splice(idx, 1); // remove
    } else {
      owned.push(ingredient); // add
    }

    db.prepare('UPDATE user_profile SET owned_ingredients = ? WHERE id = 1')
      .run(JSON.stringify(owned));

    const updated = db.prepare('SELECT * FROM user_profile WHERE id = 1').get() as RawProfile;
    res.json(parseProfile(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
