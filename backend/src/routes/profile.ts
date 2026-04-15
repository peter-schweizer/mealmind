import { Router, Response } from 'express';
import { query, queryOne } from '../db';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';

const router = Router();

// All profile routes require authentication
router.use(requireAuth);

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawProfile {
  id: number;
  clerk_user_id: string;
  name: string;
  dietary_preferences: string[];
  dislikes: string[];
  allergies: string[];
  household_size: number;
  pantry_staples: string[];
  owned_ingredients: string[];
}

function serializeProfile(raw: RawProfile) {
  return { ...raw };
}

// ─── GET /api/profile ─────────────────────────────────────────────────────────

router.get('/', async (req, res: Response) => {
  const { userId } = req;
  try {
    const raw = await queryOne<RawProfile>(
      'SELECT * FROM user_profile WHERE clerk_user_id = $1',
      [userId],
    );
    if (!raw) return res.status(404).json({ error: 'Profile not found' });
    res.json(serializeProfile(raw));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── PUT /api/profile ─────────────────────────────────────────────────────────

router.put('/', async (req, res: Response) => {
  const { userId } = req;
  try {
    const existing = await queryOne<RawProfile>(
      'SELECT * FROM user_profile WHERE clerk_user_id = $1',
      [userId],
    );
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
      WHERE clerk_user_id=$8
      RETURNING *
    `, [
      name,
      JSON.stringify(dietary_preferences ?? existing.dietary_preferences),
      JSON.stringify(dislikes ?? existing.dislikes),
      JSON.stringify(allergies ?? existing.allergies),
      household_size,
      JSON.stringify(pantry_staples ?? existing.pantry_staples),
      JSON.stringify(owned_ingredients ?? existing.owned_ingredients),
      userId,
    ]);

    res.json(serializeProfile(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/profile/pantry ─────────────────────────────────────────────────

router.post('/pantry', async (req, res: Response) => {
  const { userId } = req;
  try {
    const { pantry_staples } = req.body as { pantry_staples?: string[] };
    if (!Array.isArray(pantry_staples)) {
      return res.status(400).json({ error: 'pantry_staples must be an array of strings' });
    }

    const [updated] = await query<RawProfile>(
      'UPDATE user_profile SET pantry_staples=$1 WHERE clerk_user_id=$2 RETURNING *',
      [JSON.stringify(pantry_staples), userId],
    );
    res.json(serializeProfile(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/profile/owned ──────────────────────────────────────────────────

router.post('/owned', async (req, res: Response) => {
  const { userId } = req;
  try {
    const { ingredient } = req.body as { ingredient?: string };
    if (!ingredient) {
      return res.status(400).json({ error: 'ingredient is required' });
    }

    const raw = await queryOne<{ owned_ingredients: string[] }>(
      'SELECT owned_ingredients FROM user_profile WHERE clerk_user_id = $1',
      [userId],
    );
    if (!raw) return res.status(404).json({ error: 'Profile not found' });

    const owned: string[] = Array.isArray(raw.owned_ingredients) ? raw.owned_ingredients : [];
    const idx = owned.findIndex(o => o.toLowerCase() === ingredient.toLowerCase());
    if (idx >= 0) owned.splice(idx, 1);
    else owned.push(ingredient);

    const [updated] = await query<RawProfile>(
      'UPDATE user_profile SET owned_ingredients=$1 WHERE clerk_user_id=$2 RETURNING *',
      [JSON.stringify(owned), userId],
    );
    res.json(serializeProfile(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
