import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawProfile {
  id: number;
  name: string;
  dietary_preferences: string[];   // JSONB
  dislikes: string[];
  allergies: string[];
  household_size: number;
  pantry_staples: string[];
  owned_ingredients: string[];
}

// JSONB columns are already parsed by pg — no safeJson needed
function serializeProfile(raw: RawProfile) {
  return { ...raw };
}

// ─── GET /api/profile ─────────────────────────────────────────────────────────

router.get('/', async (_req: Request, res: Response) => {
  try {
    const raw = await queryOne<RawProfile>('SELECT * FROM user_profile WHERE id = 1');
    if (!raw) return res.status(404).json({ error: 'Profile not found' });
    res.json(serializeProfile(raw));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── PUT /api/profile ─────────────────────────────────────────────────────────

router.put('/', async (req: Request, res: Response) => {
  try {
    const existing = await queryOne<RawProfile>('SELECT * FROM user_profile WHERE id = 1');
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

    const [updated] = await query<RawProfile>(`
      UPDATE user_profile SET
        name=$1, dietary_preferences=$2, dislikes=$3, allergies=$4,
        household_size=$5, pantry_staples=$6, owned_ingredients=$7
      WHERE id=1
      RETURNING *
    `, [
      name,
      JSON.stringify(dietary_preferences ?? existing.dietary_preferences),
      JSON.stringify(dislikes ?? existing.dislikes),
      JSON.stringify(allergies ?? existing.allergies),
      household_size,
      JSON.stringify(pantry_staples ?? existing.pantry_staples),
      JSON.stringify(owned_ingredients ?? existing.owned_ingredients),
    ]);

    res.json(serializeProfile(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/profile/pantry ─────────────────────────────────────────────────

router.post('/pantry', async (req: Request, res: Response) => {
  try {
    const { pantry_staples } = req.body as { pantry_staples?: string[] };
    if (!Array.isArray(pantry_staples)) {
      return res.status(400).json({ error: 'pantry_staples must be an array of strings' });
    }

    const [updated] = await query<RawProfile>(
      'UPDATE user_profile SET pantry_staples=$1 WHERE id=1 RETURNING *',
      [JSON.stringify(pantry_staples)],
    );
    res.json(serializeProfile(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/profile/owned ──────────────────────────────────────────────────

router.post('/owned', async (req: Request, res: Response) => {
  try {
    const { ingredient } = req.body as { ingredient?: string };
    if (!ingredient) {
      return res.status(400).json({ error: 'ingredient is required' });
    }

    const raw = await queryOne<{ owned_ingredients: string[] }>(
      'SELECT owned_ingredients FROM user_profile WHERE id = 1',
    );
    if (!raw) return res.status(404).json({ error: 'Profile not found' });

    const owned: string[] = Array.isArray(raw.owned_ingredients) ? raw.owned_ingredients : [];
    const idx = owned.findIndex(o => o.toLowerCase() === ingredient.toLowerCase());
    if (idx >= 0) owned.splice(idx, 1);
    else owned.push(ingredient);

    const [updated] = await query<RawProfile>(
      'UPDATE user_profile SET owned_ingredients=$1 WHERE id=1 RETURNING *',
      [JSON.stringify(owned)],
    );
    res.json(serializeProfile(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
