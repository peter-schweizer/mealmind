import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';
import { getSuggestions } from '../services/suggestionEngine';
import { scrapeGeneric } from '../scrapers/generic';
import { scrapeChefkoch } from '../scrapers/chefkoch';
import { scrapeRewe } from '../scrapers/rewe';

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────────────

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
  dietary_tags: string[];     // JSONB — already parsed by pg
  ingredients: unknown[];     // JSONB
  instructions: string[];     // JSONB
  rating: number | null;
  notes: string;
  is_custom: boolean;
  created_at: Date;
}

function serializeRecipe(raw: RawRecipe) {
  return {
    ...raw,
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : String(raw.created_at),
  };
}

// ─── GET /api/recipes/suggestions ────────────────────────────────────────────

router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const count = parseInt(String(req.query['count'] || '10'), 10);
    const profileId = parseInt(String(req.query['profileId'] || '1'), 10);
    const suggestions = await getSuggestions(profileId, count);
    res.json(suggestions);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/recipes ────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, tags, source, is_custom } = req.query;

    let sql = 'SELECT * FROM recipes WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      sql += ` AND (title ILIKE $${idx} OR description ILIKE $${idx + 1})`;
      params.push(`%${search}%`, `%${search}%`);
      idx += 2;
    }

    if (source) {
      sql += ` AND source_name = $${idx++}`;
      params.push(source);
    }

    if (is_custom !== undefined) {
      sql += ` AND is_custom = $${idx++}`;
      params.push(is_custom === 'true' || is_custom === '1');
    }

    sql += ' ORDER BY created_at DESC';

    let recipes = (await query<RawRecipe>(sql, params)).map(serializeRecipe);

    if (tags) {
      const tagList = String(tags).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      if (tagList.length > 0) {
        recipes = recipes.filter(r =>
          tagList.every(tag =>
            (r.dietary_tags as string[]).some(t => t.toLowerCase() === tag),
          ),
        );
      }
    }

    res.json(recipes);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/recipes/:id ─────────────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const raw = await queryOne<RawRecipe>('SELECT * FROM recipes WHERE id = $1', [req.params['id']]);
    if (!raw) return res.status(404).json({ error: 'Recipe not found' });
    res.json(serializeRecipe(raw));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/recipes ────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      title, description = '', image_url = '', source_url = '', source_name = '',
      prep_time = 0, cook_time = 0, servings = 4,
      dietary_tags = [], ingredients = [], instructions = [],
      rating = null, notes = '',
    } = req.body as Partial<{
      title: string; description: string; image_url: string; source_url: string;
      source_name: string; prep_time: number; cook_time: number; servings: number;
      dietary_tags: string[]; ingredients: unknown[]; instructions: string[];
      rating: number | null; notes: string;
    }>;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const [created] = await query<RawRecipe>(`
      INSERT INTO recipes
        (title, description, image_url, source_url, source_name, prep_time, cook_time, servings,
         dietary_tags, ingredients, instructions, rating, notes, is_custom)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE)
      RETURNING *
    `, [
      title, description, image_url, source_url, source_name,
      prep_time, cook_time, servings,
      JSON.stringify(dietary_tags), JSON.stringify(ingredients), JSON.stringify(instructions),
      rating, notes,
    ]);

    res.status(201).json(serializeRecipe(created));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── PUT /api/recipes/:id ─────────────────────────────────────────────────────

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await queryOne<RawRecipe>('SELECT * FROM recipes WHERE id = $1', [req.params['id']]);
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });

    const {
      title = existing.title,
      description = existing.description,
      image_url = existing.image_url,
      source_url = existing.source_url,
      source_name = existing.source_name,
      prep_time = existing.prep_time,
      cook_time = existing.cook_time,
      servings = existing.servings,
      dietary_tags,
      ingredients,
      instructions,
      rating = existing.rating,
      notes = existing.notes,
    } = req.body as Partial<{
      title: string; description: string; image_url: string; source_url: string;
      source_name: string; prep_time: number; cook_time: number; servings: number;
      dietary_tags: string[]; ingredients: unknown[]; instructions: string[];
      rating: number | null; notes: string;
    }>;

    const [updated] = await query<RawRecipe>(`
      UPDATE recipes SET
        title=$1, description=$2, image_url=$3, source_url=$4, source_name=$5,
        prep_time=$6, cook_time=$7, servings=$8,
        dietary_tags=$9, ingredients=$10, instructions=$11,
        rating=$12, notes=$13
      WHERE id=$14
      RETURNING *
    `, [
      title, description, image_url, source_url, source_name,
      prep_time, cook_time, servings,
      JSON.stringify(dietary_tags ?? existing.dietary_tags),
      JSON.stringify(ingredients ?? existing.ingredients),
      JSON.stringify(instructions ?? existing.instructions),
      rating, notes,
      req.params['id'],
    ]);

    res.json(serializeRecipe(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── DELETE /api/recipes/:id ──────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await queryOne<{ id: number }>('SELECT id FROM recipes WHERE id = $1', [req.params['id']]);
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });
    await query('DELETE FROM recipes WHERE id = $1', [req.params['id']]);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/recipes/:id/rate ───────────────────────────────────────────────

router.post('/:id/rate', async (req: Request, res: Response) => {
  try {
    const { rating, notes } = req.body as { rating?: number; notes?: string };
    const existing = await queryOne<RawRecipe>('SELECT * FROM recipes WHERE id = $1', [req.params['id']]);
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });

    if (rating !== undefined && (rating < 0 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be between 0 and 5' });
    }

    const [updated] = await query<RawRecipe>(
      'UPDATE recipes SET rating=$1, notes=$2 WHERE id=$3 RETURNING *',
      [rating ?? existing.rating, notes ?? existing.notes, req.params['id']],
    );
    res.json(serializeRecipe(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/recipes/scrape ─────────────────────────────────────────────────

router.post('/scrape', async (req: Request, res: Response) => {
  try {
    const { url, source_name = '' } = req.body as { url?: string; source_name?: string };
    if (!url) return res.status(400).json({ error: 'url is required' });

    let scraped;
    if (url.includes('chefkoch.de')) scraped = await scrapeChefkoch(url);
    else if (url.includes('rewe.de')) scraped = await scrapeRewe(url);
    else scraped = await scrapeGeneric(url);

    const existing = await queryOne<{ id: number }>('SELECT id FROM recipes WHERE source_url = $1', [url]);

    if (existing) {
      const [updated] = await query<RawRecipe>(`
        UPDATE recipes SET
          title=$1, description=$2, image_url=$3, source_name=$4,
          prep_time=$5, cook_time=$6, servings=$7,
          dietary_tags=$8, ingredients=$9, instructions=$10
        WHERE source_url=$11
        RETURNING *
      `, [
        scraped.title, scraped.description, scraped.image_url,
        source_name || scraped.title,
        scraped.prep_time, scraped.cook_time, scraped.servings,
        JSON.stringify(scraped.dietary_tags),
        JSON.stringify(scraped.ingredients),
        JSON.stringify(scraped.instructions),
        url,
      ]);
      return res.json(serializeRecipe(updated));
    }

    const [created] = await query<RawRecipe>(`
      INSERT INTO recipes
        (title, description, image_url, source_url, source_name, prep_time, cook_time, servings,
         dietary_tags, ingredients, instructions, is_custom)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE)
      RETURNING *
    `, [
      scraped.title, scraped.description, scraped.image_url, url,
      source_name || '',
      scraped.prep_time, scraped.cook_time, scraped.servings,
      JSON.stringify(scraped.dietary_tags),
      JSON.stringify(scraped.ingredients),
      JSON.stringify(scraped.instructions),
    ]);

    res.status(201).json(serializeRecipe(created));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Scraping failed' });
  }
});

export default router;
