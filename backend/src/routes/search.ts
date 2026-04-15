import { Router, Request, Response } from 'express';
import { searchAllSources } from '../scrapers/search';

const router = Router();

/**
 * GET /api/search?q=pasta&sources=chefkoch,rewe&limit=10
 *
 * Search external recipe platforms by query string and return preview cards.
 * Individual recipes are imported on demand via POST /api/recipes/scrape.
 */
router.get('/', async (req: Request, res: Response) => {
  const query = (req.query['q'] as string | undefined)?.trim();

  if (!query) {
    res.status(400).json({ error: 'Query parameter "q" is required' });
    return;
  }

  const sourcesParam = req.query['sources'] as string | undefined;
  const sources = sourcesParam
    ? sourcesParam.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : ['chefkoch', 'rewe'];

  const limitParam = parseInt((req.query['limit'] as string | undefined) ?? '10', 10);
  const limit = isNaN(limitParam) ? 10 : Math.min(Math.max(limitParam, 1), 30);

  try {
    const results = await searchAllSources(query, { sources, limit });
    res.json(results);
  } catch (err) {
    console.error('[search] Error:', err);
    res.status(500).json({ error: 'Suche fehlgeschlagen' });
  }
});

export default router;
