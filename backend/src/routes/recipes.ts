import { Router, Request, Response } from 'express';
import db from '../db';
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
  dietary_tags: string;
  ingredients: string;
  instructions: string;
  rating: number | null;
  notes: string;
  is_custom: number;
  created_at: string;
}

function parseRecipe(raw: RawRecipe) {
  return {
    ...raw,
    dietary_tags: safeJson(raw.dietary_tags, []),
    ingredients: safeJson(raw.ingredients, []),
    instructions: safeJson(raw.instructions, []),
  };
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

// ─── GET /api/recipes/suggestions ────────────────────────────────────────────
// Must be before /:id route to avoid conflict

router.get('/suggestions', (req: Request, res: Response) => {
  try {
    const count = parseInt(String(req.query['count'] || '10'), 10);
    const profileId = parseInt(String(req.query['profileId'] || '1'), 10);
    const suggestions = getSuggestions(profileId, count);
    res.json(suggestions);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/recipes ────────────────────────────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  try {
    const { search, tags, source, is_custom } = req.query;

    let query = 'SELECT * FROM recipes WHERE 1=1';
    const params: unknown[] = [];

    if (search) {
      query += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (source) {
      query += ' AND source_name = ?';
      params.push(source);
    }

    if (is_custom !== undefined) {
      query += ' AND is_custom = ?';
      params.push(is_custom === 'true' || is_custom === '1' ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';

    let recipes = (db.prepare(query).all(...params) as RawRecipe[]).map(parseRecipe);

    // Filter by tags (all specified tags must be present)
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

router.get('/:id', (req: Request, res: Response) => {
  try {
    const raw = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params['id']) as RawRecipe | undefined;
    if (!raw) return res.status(404).json({ error: 'Recipe not found' });
    res.json(parseRecipe(raw));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/recipes ────────────────────────────────────────────────────────

router.post('/', (req: Request, res: Response) => {
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

    const result = db.prepare(`
      INSERT INTO recipes
        (title, description, image_url, source_url, source_name, prep_time, cook_time, servings,
         dietary_tags, ingredients, instructions, rating, notes, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      title, description, image_url, source_url, source_name,
      prep_time, cook_time, servings,
      JSON.stringify(dietary_tags), JSON.stringify(ingredients), JSON.stringify(instructions),
      rating, notes,
    );

    const created = db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid) as RawRecipe;
    res.status(201).json(parseRecipe(created));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── PUT /api/recipes/:id ─────────────────────────────────────────────────────

router.put('/:id', (req: Request, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params['id']) as RawRecipe | undefined;
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

    db.prepare(`
      UPDATE recipes SET
        title = ?, description = ?, image_url = ?, source_url = ?, source_name = ?,
        prep_time = ?, cook_time = ?, servings = ?,
        dietary_tags = ?, ingredients = ?, instructions = ?,
        rating = ?, notes = ?
      WHERE id = ?
    `).run(
      title, description, image_url, source_url, source_name,
      prep_time, cook_time, servings,
      JSON.stringify(dietary_tags ?? safeJson(existing.dietary_tags, [])),
      JSON.stringify(ingredients ?? safeJson(existing.ingredients, [])),
      JSON.stringify(instructions ?? safeJson(existing.instructions, [])),
      rating, notes,
      req.params['id'],
    );

    const updated = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params['id']) as RawRecipe;
    res.json(parseRecipe(updated));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── DELETE /api/recipes/:id ──────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const existing = db.prepare('SELECT id FROM recipes WHERE id = ?').get(req.params['id']);
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });
    db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params['id']);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/recipes/:id/rate ───────────────────────────────────────────────

router.post('/:id/rate', (req: Request, res: Response) => {
  try {
    const { rating, notes } = req.body as { rating?: number; notes?: string };
    const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params['id']) as RawRecipe | undefined;
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });

    if (rating !== undefined && (rating < 0 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be between 0 and 5' });
    }

    db.prepare('UPDATE recipes SET rating = ?, notes = ? WHERE id = ?').run(
      rating ?? existing.rating,
      notes ?? existing.notes,
      req.params['id'],
    );

    const updated = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params['id']) as RawRecipe;
    res.json(parseRecipe(updated));
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
    if (url.includes('chefkoch.de')) {
      scraped = await scrapeChefkoch(url);
    } else if (url.includes('rewe.de')) {
      scraped = await scrapeRewe(url);
    } else {
      scraped = await scrapeGeneric(url);
    }

    // Check if recipe with this URL already exists
    const existing = db.prepare('SELECT id FROM recipes WHERE source_url = ?').get(url) as { id: number } | undefined;

    if (existing) {
      // Update existing
      db.prepare(`
        UPDATE recipes SET
          title = ?, description = ?, image_url = ?, source_name = ?,
          prep_time = ?, cook_time = ?, servings = ?,
          dietary_tags = ?, ingredients = ?, instructions = ?
        WHERE source_url = ?
      `).run(
        scraped.title, scraped.description, scraped.image_url,
        source_name || scraped.title,
        scraped.prep_time, scraped.cook_time, scraped.servings,
        JSON.stringify(scraped.dietary_tags),
        JSON.stringify(scraped.ingredients),
        JSON.stringify(scraped.instructions),
        url,
      );
      const updated = db.prepare('SELECT * FROM recipes WHERE source_url = ?').get(url) as RawRecipe;
      return res.json(parseRecipe(updated));
    }

    // Insert new
    const result = db.prepare(`
      INSERT INTO recipes
        (title, description, image_url, source_url, source_name, prep_time, cook_time, servings,
         dietary_tags, ingredients, instructions, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      scraped.title, scraped.description, scraped.image_url, url,
      source_name || '',
      scraped.prep_time, scraped.cook_time, scraped.servings,
      JSON.stringify(scraped.dietary_tags),
      JSON.stringify(scraped.ingredients),
      JSON.stringify(scraped.instructions),
    );

    const created = db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid) as RawRecipe;
    res.status(201).json(parseRecipe(created));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Scraping failed' });
  }
});

export default router;
