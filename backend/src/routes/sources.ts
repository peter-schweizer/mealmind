import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db';
import { scrapeChefkoch, discoverChefkochUrls } from '../scrapers/chefkoch';
import { scrapeRewe, discoverReweUrls } from '../scrapers/rewe';
import { scrapeGeneric } from '../scrapers/generic';
import {
  getSourceDefinition,
  getAllSourceDefinitions,
  getAuthConfig,
  type StoredAuthData,
} from '../auth/registry';
import axios from 'axios';
import * as cheerio from 'cheerio';

const router = Router();

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

router.get('/', async (_req: Request, res: Response) => {
  try {
    const sources = await query<RawSource>('SELECT * FROM recipe_sources ORDER BY name ASC');
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
        'INSERT INTO recipe_sources (name, url, scraper_type, status) VALUES ($1,$2,$3,$4) ON CONFLICT (url) DO NOTHING RETURNING *',
        [name, url, detectedType, 'active'],
      );
      if (!created) return res.status(409).json({ error: 'A source with this URL already exists' });
      res.status(201).json(serializeSource(created));
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        return res.status(409).json({ error: 'A source with this URL already exists' });
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
    const source = await queryOne<{ id: number }>('SELECT id FROM recipe_sources WHERE id = $1', [req.params['id']]);
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

  const limit = parseInt(String(req.query['limit'] || '10'), 10);

  const def = getSourceDefinition(source.scraper_type);
  let extraHeaders: Record<string, string> = {};
  if (source.auth_status === 'authenticated' && source.auth_data && def.authHeaders) {
    try {
      extraHeaders = def.authHeaders(JSON.parse(source.auth_data) as StoredAuthData);
    } catch { /* ignore */ }
  }

  try {
    const recipeUrls = await discoverRecipeUrls(source.url, source.scraper_type, limit);

    const existingRows = await query<{ source_url: string }>(
      "SELECT source_url FROM recipes WHERE source_url != ''",
    );
    const knownUrls = new Set(existingRows.map(r => r.source_url));
    const newUrls = recipeUrls.filter(u => !knownUrls.has(u));

    const results: Array<{ url: string; status: 'success' | 'error'; error?: string; title?: string }> = [];

    for (const url of newUrls.slice(0, limit)) {
      try {
        let scraped;
        if (source.scraper_type === 'chefkoch') scraped = await scrapeChefkoch(url, extraHeaders);
        else if (source.scraper_type === 'rewe') scraped = await scrapeRewe(url, extraHeaders);
        else scraped = await scrapeGeneric(url);

        await query(`
          INSERT INTO recipes
            (title, description, image_url, source_url, source_name, prep_time, cook_time, servings,
             dietary_tags, ingredients, instructions, is_custom)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE)
          ON CONFLICT (source_url) DO NOTHING
        `, [
          scraped.title, scraped.description, scraped.image_url, url, source.name,
          scraped.prep_time, scraped.cook_time, scraped.servings,
          JSON.stringify(scraped.dietary_tags),
          JSON.stringify(scraped.ingredients),
          JSON.stringify(scraped.instructions),
        ]);

        results.push({ url, status: 'success', title: scraped.title });
        await sleep(500);
      } catch (err: unknown) {
        results.push({ url, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;

    const [updated] = await query<RawSource>(`
      UPDATE recipe_sources SET
        status='active', last_sync=NOW(), error_message=NULL
      WHERE id=$1
      RETURNING *
    `, [sourceId]);

    res.json({ source: serializeSource(updated), discovered: recipeUrls.length, new: newUrls.length, scraped: successCount, results });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Sync failed';
    await query("UPDATE recipe_sources SET status='error', error_message=$1 WHERE id=$2", [errorMsg, sourceId]);
    res.status(500).json({ error: errorMsg });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function discoverRecipeUrls(baseUrl: string, scraperType: string, limit: number): Promise<string[]> {
  if (scraperType === 'chefkoch') return discoverChefkochUrls(baseUrl, limit);
  if (scraperType === 'rewe') return discoverReweUrls(baseUrl, limit);

  const urls = await tryGenericSitemap(baseUrl, limit);
  if (urls.length > 0) return urls;
  return discoverFromHomepage(baseUrl, limit);
}

async function tryGenericSitemap(baseUrl: string, limit: number): Promise<string[]> {
  const { protocol, host } = new URL(baseUrl);
  for (const sitemapUrl of [`${protocol}//${host}/sitemap.xml`, `${protocol}//${host}/sitemap-recipes.xml`]) {
    try {
      const response = await axios.get<string>(sitemapUrl, { timeout: 8000, headers: { 'User-Agent': 'MealMindBot/1.0' } });
      const $ = cheerio.load(response.data, { xmlMode: true });
      const urls: string[] = [];
      $('url loc').each((_, el) => {
        const loc = $(el).text().trim();
        if (loc && (loc.includes('rezept') || loc.includes('recipe'))) urls.push(loc);
      });
      if (urls.length > 0) return urls.slice(0, limit);
    } catch { /* try next */ }
  }
  return [];
}

async function discoverFromHomepage(baseUrl: string, limit: number): Promise<string[]> {
  try {
    const response = await axios.get<string>(baseUrl, { timeout: 10000, headers: { 'User-Agent': 'MealMindBot/1.0' } });
    const $ = cheerio.load(response.data);
    const { protocol, host } = new URL(baseUrl);
    const baseOrigin = `${protocol}//${host}`;
    const urls = new Set<string>();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('rezept') || href.includes('recipe')) {
        urls.add((href.startsWith('http') ? href : `${baseOrigin}${href}`).split('?')[0]);
      }
    });
    return [...urls].slice(0, limit);
  } catch {
    return [];
  }
}

export default router;
