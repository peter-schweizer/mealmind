import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';
import { scrapeChefkoch, discoverChefkochUrls } from '../scrapers/chefkoch';
import { scrapeRewe, discoverReweUrls } from '../scrapers/rewe';
import { scrapeGeneric } from '../scrapers/generic';
import { discoverViaSitemap, looksLikeRecipeUrl, MINER_UA } from '../scrapers/sitemap';
import { extractJsonLdRecipe } from '../scrapers/jsonld';
import {
  getSourceDefinition,
  getAllSourceDefinitions,
  getAuthConfig,
  type StoredAuthData,
} from '../auth/registry';
import { requireAuth } from '../middleware/requireAuth';
import axios from 'axios';
import * as cheerio from 'cheerio';

const router = Router();

// All source routes require authentication
router.use(requireAuth);

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawSource {
  id: number;
  name: string;
  url: string;
  scraper_type: string;
  status: string;
  last_sync: Date | null;
  error_message: string | null;
  auth_type: string;
  auth_data: string | null;
  auth_status: string;
  auth_error: string | null;
  auth_username: string | null;
}

function serializeSource(raw: RawSource) {
  const { auth_data: _hidden, last_sync, ...safe } = raw;
  return {
    ...safe,
    last_sync: last_sync instanceof Date ? last_sync.toISOString() : last_sync,
    auth_config: getAuthConfig(raw.scraper_type),
    is_authenticated: raw.auth_status === 'authenticated',
  };
}

// ─── GET /api/sources ─────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const sources = await query<RawSource>(
      'SELECT * FROM recipe_sources WHERE user_id = $1 ORDER BY name ASC',
      [req.userId],
    );
    res.json(sources.map(serializeSource));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/sources/registry ────────────────────────────────────────────────

router.get('/registry', (_req: Request, res: Response) => {
  const definitions = getAllSourceDefinitions().map((def) => ({
    scraper_type: def.scraper_type,
    name: def.name,
    defaultUrl: def.defaultUrl,
    description: def.description,
    icon: def.icon,
    supportsAuth: !!def.authConfig,
    authConfig: def.authConfig ?? null,
  }));
  res.json(definitions);
});

// ─── POST /api/sources ────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, url, scraper_type = 'generic' } = req.body as {
      name?: string; url?: string; scraper_type?: string;
    };

    if (!name || !url) return res.status(400).json({ error: 'name and url are required' });

    try { new URL(url); } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    let detectedType = scraper_type;
    if (url.includes('chefkoch.de')) detectedType = 'chefkoch';
    else if (url.includes('rewe.de')) detectedType = 'rewe';

    const validTypes = ['chefkoch', 'rewe', 'generic'];
    if (!validTypes.includes(detectedType)) {
      return res.status(400).json({ error: `scraper_type must be one of: ${validTypes.join(', ')}` });
    }

    try {
      const [created] = await query<RawSource>(
        `INSERT INTO recipe_sources (name, url, scraper_type, status, user_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, url) WHERE user_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [name, url, detectedType, 'active', req.userId],
      );
      if (!created) return res.status(409).json({ error: 'Diese Quelle existiert bereits in deinem Konto' });
      res.status(201).json(serializeSource(created));
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        return res.status(409).json({ error: 'Diese Quelle existiert bereits in deinem Konto' });
      }
      throw err;
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── DELETE /api/sources/:id ──────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const source = await queryOne<{ id: number }>(
      'SELECT id FROM recipe_sources WHERE id = $1 AND user_id = $2',
      [req.params['id'], req.userId],
    );
    if (!source) return res.status(404).json({ error: 'Source not found' });
    await query('DELETE FROM recipe_sources WHERE id = $1', [req.params['id']]);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/sources/:id/login ──────────────────────────────────────────────

router.post('/:id/login', async (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = await queryOne<RawSource>('SELECT * FROM recipe_sources WHERE id = $1', [sourceId]);
  if (!source) return res.status(404).json({ error: 'Source not found' });

  const def = getSourceDefinition(source.scraper_type);
  if (!def.authConfig || !def.login) {
    return res.status(400).json({ error: 'This source does not support authentication' });
  }

  const credentials = req.body as Record<string, string>;
  const missing = def.authConfig.fields.filter((f) => !credentials[f.key]).map((f) => f.label);
  if (missing.length > 0) return res.status(400).json({ error: `Fehlende Felder: ${missing.join(', ')}` });

  try {
    const authData = await def.login(credentials, source.url);

    const [updated] = await query<RawSource>(`
      UPDATE recipe_sources SET
        auth_type=$1, auth_data=$2, auth_status='authenticated',
        auth_error=NULL, auth_username=$3
      WHERE id=$4
      RETURNING *
    `, [
      def.authConfig ? 'cookie_login' : 'none',
      JSON.stringify(authData),
      authData.username ?? credentials['email'] ?? null,
      sourceId,
    ]);

    res.json(serializeSource(updated));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Login fehlgeschlagen';
    await query(
      "UPDATE recipe_sources SET auth_status='error', auth_error=$1 WHERE id=$2",
      [msg, sourceId],
    );
    res.status(401).json({ error: msg });
  }
});

// ─── POST /api/sources/:id/logout ─────────────────────────────────────────────

router.post('/:id/logout', async (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = await queryOne<{ id: number }>('SELECT id FROM recipe_sources WHERE id = $1', [sourceId]);
  if (!source) return res.status(404).json({ error: 'Source not found' });

  const [updated] = await query<RawSource>(`
    UPDATE recipe_sources SET
      auth_data=NULL, auth_type='none', auth_status='unauthenticated',
      auth_error=NULL, auth_username=NULL
    WHERE id=$1
    RETURNING *
  `, [sourceId]);

  res.json(serializeSource(updated));
});

// ─── POST /api/sources/:id/validate-session ───────────────────────────────────

router.post('/:id/validate-session', async (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = await queryOne<RawSource>('SELECT * FROM recipe_sources WHERE id = $1', [sourceId]);
  if (!source) return res.status(404).json({ error: 'Source not found' });

  if (source.auth_status !== 'authenticated' || !source.auth_data) return res.json({ valid: false });

  const def = getSourceDefinition(source.scraper_type);
  if (!def.validateSession) return res.json({ valid: true });

  try {
    const authData = JSON.parse(source.auth_data) as StoredAuthData;
    const valid = await def.validateSession(authData, source.url);

    if (!valid) {
      await query(
        "UPDATE recipe_sources SET auth_status='error', auth_error='Sitzung abgelaufen – bitte neu anmelden.' WHERE id=$1",
        [sourceId],
      );
    }
    res.json({ valid });
  } catch {
    res.json({ valid: false });
  }
});

// ─── POST /api/sources/:id/sync ───────────────────────────────────────────────

router.post('/:id/sync', async (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = await queryOne<RawSource>('SELECT * FROM recipe_sources WHERE id = $1', [sourceId]);
  if (!source) return res.status(404).json({ error: 'Source not found' });

  await query("UPDATE recipe_sources SET status='syncing', error_message=NULL WHERE id=$1", [sourceId]);

  // How many new recipes to import per sync (caller can override with ?limit=N, max 100)
  const limit = Math.min(parseInt(String(req.query['limit'] || '20'), 10), 100);

  const def = getSourceDefinition(source.scraper_type);
  let extraHeaders: Record<string, string> = {};
  if (source.auth_status === 'authenticated' && source.auth_data && def.authHeaders) {
    try {
      extraHeaders = def.authHeaders(JSON.parse(source.auth_data) as StoredAuthData);
    } catch { /* ignore */ }
  }

  try {
    // ── 1. Discover recipe URLs ──────────────────────────────────────────────
    const recipeUrls = await discoverRecipeUrls(source.url, source.scraper_type);

    // ── 2. Filter out already-known URLs ────────────────────────────────────
    const existingRows = await query<{ source_url: string }>(
      "SELECT source_url FROM recipes WHERE source_url IS NOT NULL AND source_url != ''",
    );
    const knownUrls = new Set(existingRows.map((r) => r.source_url));
    const newUrls = recipeUrls.filter((u) => !knownUrls.has(u));

    // ── 3. Scrape each new URL ───────────────────────────────────────────────
    const results: Array<{ url: string; status: 'success' | 'error'; method?: string; error?: string; title?: string }> = [];

    for (const url of newUrls.slice(0, limit)) {
      try {
        const scraped = await scrapeWithFallback(url, source.scraper_type, extraHeaders);

        await query(`
          INSERT INTO recipes
            (title, description, image_url, source_url, source_name, prep_time, cook_time, servings,
             dietary_tags, ingredients, instructions, is_custom)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE)
          ON CONFLICT (source_url) DO NOTHING
        `, [
          scraped.recipe.title,
          scraped.recipe.description,
          scraped.recipe.image_url,
          url,
          source.name,
          scraped.recipe.prep_time,
          scraped.recipe.cook_time,
          scraped.recipe.servings,
          JSON.stringify(scraped.recipe.dietary_tags),
          JSON.stringify(scraped.recipe.ingredients),
          JSON.stringify(scraped.recipe.instructions),
        ]);

        results.push({ url, status: 'success', method: scraped.method, title: scraped.recipe.title });
        await sleep(2_000); // polite rate limit between imports
      } catch (err: unknown) {
        results.push({
          url,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        await sleep(500);
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const jsonLdCount = results.filter((r) => r.method === 'jsonld').length;

    const [updated] = await query<RawSource>(`
      UPDATE recipe_sources SET
        status='active', last_sync=NOW(), error_message=NULL
      WHERE id=$1
      RETURNING *
    `, [sourceId]);

    res.json({
      source: serializeSource(updated),
      discovered: recipeUrls.length,
      new: newUrls.length,
      scraped: successCount,
      jsonld_used: jsonLdCount,
      results,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Sync failed';
    await query("UPDATE recipe_sources SET status='error', error_message=$1 WHERE id=$2", [errorMsg, sourceId]);
    res.status(500).json({ error: errorMsg });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Discover recipe URLs for a source.
 *
 * Priority:
 *   1. Sitemap crawler (robots.txt-compliant, recursive, for all types)
 *   2. Site-specific URL lists as fallback (Chefkoch / REWE API search)
 *   3. Homepage link extraction as last resort
 */
async function discoverRecipeUrls(baseUrl: string, scraperType: string): Promise<string[]> {
  // Try sitemap first — works for all sources
  const sitemapUrls = await discoverViaSitemap(baseUrl, { maxUrls: 500 });
  if (sitemapUrls.length > 0) return sitemapUrls;

  // Fallback to site-specific discovery
  console.log(`[sync] No sitemap results for ${baseUrl}, trying site-specific discovery`);
  if (scraperType === 'chefkoch') return discoverChefkochUrls(baseUrl, 100);
  if (scraperType === 'rewe') return discoverReweUrls(baseUrl, 100);

  // Last resort: extract recipe-looking links from the homepage
  return discoverFromHomepage(baseUrl, 100);
}

interface ScrapeResult {
  recipe: import('../scrapers/generic').ScrapedRecipe;
  method: 'jsonld' | 'chefkoch' | 'rewe' | 'generic';
}

/**
 * Scrape a single recipe URL.
 *
 * Strategy:
 *   1. Fetch the page HTML once
 *   2. Try JSON-LD extraction (universal, most reliable)
 *   3. If confidence is high → done
 *   4. Otherwise fall back to the site-specific scraper for richer data
 */
async function scrapeWithFallback(
  url: string,
  scraperType: string,
  extraHeaders: Record<string, string>,
): Promise<ScrapeResult> {
  // Fetch HTML once — reuse for both JSON-LD and fallback HTML parsers
  const { data: html } = await axios.get<string>(url, {
    timeout: 15_000,
    headers: {
      'User-Agent': MINER_UA,
      Accept: 'text/html,application/xhtml+xml',
      ...extraHeaders,
    },
    responseType: 'text',
    maxRedirects: 5,
  });

  // ── Attempt 1: JSON-LD (Schema.org — no site-specific knowledge needed) ──
  const jsonLdResult = extractJsonLdRecipe(html, url);
  if (jsonLdResult && jsonLdResult.confidence === 'high') {
    return { recipe: jsonLdResult.recipe, method: 'jsonld' };
  }

  // ── Attempt 2: site-specific scraper (may return richer data) ─────────────
  try {
    let recipe;
    if (scraperType === 'chefkoch') recipe = await scrapeChefkoch(url, extraHeaders);
    else if (scraperType === 'rewe') recipe = await scrapeRewe(url, extraHeaders);
    else recipe = await scrapeGeneric(url);
    return { recipe, method: scraperType as ScrapeResult['method'] };
  } catch {
    // Site-specific scraper failed — use JSON-LD result even if medium/low confidence
    if (jsonLdResult) return { recipe: jsonLdResult.recipe, method: 'jsonld' };
    throw new Error(`Could not extract recipe from ${url}`);
  }
}

async function discoverFromHomepage(baseUrl: string, limit: number): Promise<string[]> {
  try {
    const { data: html } = await axios.get<string>(baseUrl, {
      timeout: 12_000,
      headers: { 'User-Agent': MINER_UA },
    });
    const $ = cheerio.load(html);
    const { origin } = new URL(baseUrl);
    const urls = new Set<string>();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const full = href.startsWith('http') ? href : `${origin}${href}`;
      if (looksLikeRecipeUrl(full.split('?')[0])) urls.add(full.split('?')[0]);
    });
    return [...urls].slice(0, limit);
  } catch {
    return [];
  }
}

export default router;
