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

// ─── POST /api/sources/:id/discover ──────────────────────────────────────────
//
// Step 1 of the two-step sync flow.
// Discovers up to 30 new recipe URLs and fetches their metadata via JSON-LD.
// NOTHING is written to the database — returns a preview list for the user
// to review and select from.

router.post('/:id/discover', async (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = await queryOne<RawSource>('SELECT * FROM recipe_sources WHERE id = $1', [sourceId]);
  if (!source) return res.status(404).json({ error: 'Source not found' });

  const PREVIEW_LIMIT = 30;

  const def = getSourceDefinition(source.scraper_type);
  let extraHeaders: Record<string, string> = {};
  if (source.auth_status === 'authenticated' && source.auth_data && def.authHeaders) {
    try { extraHeaders = def.authHeaders(JSON.parse(source.auth_data) as StoredAuthData); } catch { /* ignore */ }
  }

  try {
    // 1. Find candidate URLs via sitemap / site-specific discovery
    const allUrls = await discoverRecipeUrls(source.url, source.scraper_type);

    // 2. Filter out URLs already in the DB
    const existingRows = await query<{ source_url: string }>(
      "SELECT source_url FROM recipes WHERE source_url IS NOT NULL AND source_url != ''",
    );
    const knownUrls = new Set(existingRows.map((r) => r.source_url));
    const newUrls = allUrls.filter((u) => !knownUrls.has(u)).slice(0, PREVIEW_LIMIT);

    // 3. Fetch lightweight metadata for each URL (JSON-LD only — fast, no full scrape)
    const previews: RecipePreview[] = [];
    for (const url of newUrls) {
      try {
        const preview = await fetchPreview(url, source.name, extraHeaders);
        if (preview) previews.push(preview);
        await sleep(1_000); // polite rate limit
      } catch {
        // Skip URLs that fail to load — don't surface errors to the user
      }
    }

    res.json({
      total_discovered: allUrls.length,
      new_found: newUrls.length,
      previews,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Discovery failed' });
  }
});

// ─── POST /api/sources/:id/import ─────────────────────────────────────────────
//
// Step 2 of the two-step sync flow.
// Receives { urls: string[] } of user-selected URLs and imports them fully.

router.post('/:id/import', async (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = await queryOne<RawSource>('SELECT * FROM recipe_sources WHERE id = $1', [sourceId]);
  if (!source) return res.status(404).json({ error: 'Source not found' });

  const urls: string[] = Array.isArray(req.body?.urls) ? (req.body.urls as string[]) : [];
  if (urls.length === 0) return res.status(400).json({ error: 'No URLs provided' });
  if (urls.length > 30) return res.status(400).json({ error: 'Maximum 30 URLs per import' });

  await query("UPDATE recipe_sources SET status='syncing', error_message=NULL WHERE id=$1", [sourceId]);

  const def = getSourceDefinition(source.scraper_type);
  let extraHeaders: Record<string, string> = {};
  if (source.auth_status === 'authenticated' && source.auth_data && def.authHeaders) {
    try { extraHeaders = def.authHeaders(JSON.parse(source.auth_data) as StoredAuthData); } catch { /* ignore */ }
  }

  const results: Array<{ url: string; status: 'success' | 'error'; title?: string; error?: string }> = [];

  for (const url of urls) {
    try {
      const scraped = await scrapeWithFallback(url, source.scraper_type, extraHeaders);

      await query(`
        INSERT INTO recipes
          (title, description, image_url, source_url, source_name, prep_time, cook_time,
           servings, dietary_tags, ingredients, instructions, is_custom)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE)
        ON CONFLICT (source_url) DO NOTHING
      `, [
        scraped.recipe.title, scraped.recipe.description, scraped.recipe.image_url,
        url, source.name, scraped.recipe.prep_time, scraped.recipe.cook_time,
        scraped.recipe.servings,
        JSON.stringify(scraped.recipe.dietary_tags),
        JSON.stringify(scraped.recipe.ingredients),
        JSON.stringify(scraped.recipe.instructions),
      ]);

      results.push({ url, status: 'success', title: scraped.recipe.title });
      await sleep(2_000); // polite rate limit
    } catch (err: unknown) {
      results.push({ url, status: 'error', error: err instanceof Error ? err.message : 'Unknown' });
      await sleep(500);
    }
  }

  const successCount = results.filter((r) => r.status === 'success').length;

  const [updated] = await query<RawSource>(`
    UPDATE recipe_sources SET status='active', last_sync=NOW(), error_message=NULL
    WHERE id=$1 RETURNING *
  `, [sourceId]);

  res.json({ source: serializeSource(updated), imported: successCount, results });
});

// ─── POST /api/sources/:id/sync (legacy — kept for backwards compat) ──────────

router.post('/:id/sync', async (req: Request, res: Response) => {
  // Redirect internally: discover → import all
  const sourceId = parseInt(req.params['id'], 10);
  const source = await queryOne<RawSource>('SELECT * FROM recipe_sources WHERE id = $1', [sourceId]);
  if (!source) return res.status(404).json({ error: 'Source not found' });

  await query("UPDATE recipe_sources SET status='syncing', error_message=NULL WHERE id=$1", [sourceId]);

  const def = getSourceDefinition(source.scraper_type);
  let extraHeaders: Record<string, string> = {};
  if (source.auth_status === 'authenticated' && source.auth_data && def.authHeaders) {
    try { extraHeaders = def.authHeaders(JSON.parse(source.auth_data) as StoredAuthData); } catch { /* ignore */ }
  }

  try {
    const allUrls = await discoverRecipeUrls(source.url, source.scraper_type);
    const existingRows = await query<{ source_url: string }>(
      "SELECT source_url FROM recipes WHERE source_url IS NOT NULL AND source_url != ''",
    );
    const knownUrls = new Set(existingRows.map((r) => r.source_url));
    const newUrls = allUrls.filter((u) => !knownUrls.has(u)).slice(0, 30);

    const results: Array<{ url: string; status: string; title?: string }> = [];
    for (const url of newUrls) {
      try {
        const scraped = await scrapeWithFallback(url, source.scraper_type, extraHeaders);
        await query(`
          INSERT INTO recipes
            (title, description, image_url, source_url, source_name, prep_time, cook_time,
             servings, dietary_tags, ingredients, instructions, is_custom)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE)
          ON CONFLICT (source_url) DO NOTHING
        `, [
          scraped.recipe.title, scraped.recipe.description, scraped.recipe.image_url,
          url, source.name, scraped.recipe.prep_time, scraped.recipe.cook_time,
          scraped.recipe.servings,
          JSON.stringify(scraped.recipe.dietary_tags),
          JSON.stringify(scraped.recipe.ingredients),
          JSON.stringify(scraped.recipe.instructions),
        ]);
        results.push({ url, status: 'success', title: scraped.recipe.title });
        await sleep(2_000);
      } catch { results.push({ url, status: 'error' }); await sleep(500); }
    }

    const [updated] = await query<RawSource>(
      "UPDATE recipe_sources SET status='active', last_sync=NOW(), error_message=NULL WHERE id=$1 RETURNING *",
      [sourceId],
    );
    res.json({ source: serializeSource(updated), discovered: allUrls.length, scraped: results.filter(r => r.status === 'success').length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    await query("UPDATE recipe_sources SET status='error', error_message=$1 WHERE id=$2", [msg, sourceId]);
    res.status(500).json({ error: msg });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

export interface RecipePreview {
  url: string;
  title: string;
  image_url?: string;
  description?: string;
  prep_time?: number;
  servings?: number;
  source_name: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch lightweight recipe metadata for a URL without writing to DB. */
async function fetchPreview(
  url: string,
  sourceName: string,
  extraHeaders: Record<string, string>,
): Promise<RecipePreview | null> {
  const { data: html } = await axios.get<string>(url, {
    timeout: 10_000,
    headers: { 'User-Agent': MINER_UA, Accept: 'text/html,application/xhtml+xml', ...extraHeaders },
    responseType: 'text',
    maxRedirects: 5,
  });
  const result = extractJsonLdRecipe(html, url);
  if (!result || !result.recipe.title) return null;
  const { recipe } = result;
  return {
    url,
    title: recipe.title,
    image_url: recipe.image_url || undefined,
    description: recipe.description || undefined,
    prep_time: recipe.prep_time || undefined,
    servings: recipe.servings || undefined,
    source_name: sourceName,
  };
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
