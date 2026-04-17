/**
 * Public share endpoints — no authentication required.
 * Anyone with the token URL can view the shared content (read-only).
 */
import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';
import crypto from 'crypto';

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawPlan {
  id: number; name: string; week_start: string;
  created_at: Date; share_token: string | null; user_id: string | null;
}
interface RawSlot {
  id: number; plan_id: number; day: number; meal_type: string; recipe_id: number;
}
interface RawRecipe {
  id: number; title: string; description: string; image_url: string;
  source_url: string; source_name: string; prep_time: number; cook_time: number;
  servings: number; dietary_tags: unknown; ingredients: unknown; instructions: unknown;
  rating: number | null; notes: string; is_custom: boolean; created_at: Date;
  share_token: string | null;
}

function serializePlan(raw: RawPlan) {
  return { ...raw, week_start: String(raw.week_start).substring(0, 10),
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : String(raw.created_at) };
}
function serializeRecipe(raw: RawRecipe) {
  const { share_token: _, ...rest } = raw; void _;
  return { ...rest, created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : String(raw.created_at) };
}

function generateToken(): string {
  return crypto.randomUUID();
}

// ─── GET /api/share/plan/:token — public, no auth ─────────────────────────────

router.get('/plan/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const plan = await queryOne<RawPlan>(
    'SELECT * FROM week_plans WHERE share_token = $1', [token]
  );
  if (!plan) return res.status(404).json({ error: 'Plan nicht gefunden oder Link abgelaufen.' });

  const slots = await query<RawSlot>(
    'SELECT * FROM meal_slots WHERE plan_id = $1 ORDER BY day, meal_type', [plan.id]
  );
  const enriched = await Promise.all(slots.map(async (slot) => {
    const recipe = await queryOne<RawRecipe>('SELECT * FROM recipes WHERE id = $1', [slot.recipe_id]);
    return { ...slot, recipe: recipe ? serializeRecipe(recipe) : null };
  }));

  res.json({ plan: serializePlan(plan), slots: enriched });
});

// ─── GET /api/share/recipe/:token — public, no auth ──────────────────────────

router.get('/recipe/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const recipe = await queryOne<RawRecipe>(
    'SELECT * FROM recipes WHERE share_token = $1', [token]
  );
  if (!recipe) return res.status(404).json({ error: 'Rezept nicht gefunden oder Link abgelaufen.' });
  res.json(serializeRecipe(recipe));
});

// ─── POST /api/share/plan/:id — generate share token (auth handled by caller) ─

router.post('/plan/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params['id'], 10);
  const plan = await queryOne<RawPlan>('SELECT * FROM week_plans WHERE id = $1', [id]);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  // Reuse existing token or create new one
  const token = plan.share_token ?? generateToken();
  await query('UPDATE week_plans SET share_token = $1 WHERE id = $2', [token, id]);
  res.json({ token, url: `/share/plan/${token}` });
});

// ─── DELETE /api/share/plan/:id — revoke share token ─────────────────────────

router.delete('/plan/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params['id'], 10);
  await query('UPDATE week_plans SET share_token = NULL WHERE id = $1', [id]);
  res.json({ ok: true });
});

// ─── POST /api/share/recipe/:id — generate share token ───────────────────────

router.post('/recipe/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params['id'], 10);
  const recipe = await queryOne<RawRecipe>('SELECT * FROM recipes WHERE id = $1', [id]);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

  const token = recipe.share_token ?? generateToken();
  await query('UPDATE recipes SET share_token = $1 WHERE id = $2', [token, id]);
  res.json({ token, url: `/share/recipe/${token}` });
});

// ─── DELETE /api/share/recipe/:id — revoke share token ───────────────────────

router.delete('/recipe/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params['id'], 10);
  await query('UPDATE recipes SET share_token = NULL WHERE id = $1', [id]);
  res.json({ ok: true });
});

export default router;
