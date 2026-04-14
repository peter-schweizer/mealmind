import { Router, Request, Response } from 'express';
import db from '../db';
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
  last_sync: string | null;
  error_message: string | null;
  auth_type: string;
  auth_data: string | null;
  auth_status: string;
  auth_error: string | null;
  auth_username: string | null;
}

interface RawRecipe {
  id: number;
  source_url: string;
}

function serializeSource(raw: RawSource) {
  // Never expose raw auth_data (cookies/tokens) to the frontend
  const { auth_data: _hidden, ...safe } = raw;
  return {
    ...safe,
    auth_config: getAuthConfig(raw.scraper_type),
    is_authenticated: raw.auth_status === 'authenticated',
  };
}

// ─── GET /api/sources ─────────────────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  try {
    const sources = db.prepare('SELECT * FROM recipe_sources ORDER BY name ASC').all() as unknown as RawSource[];
    res.json(sources.map(serializeSource));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── GET /api/sources/registry ────────────────────────────────────────────────
// Returns all known source definitions (for the "Bekannte Quellen" UI)

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

router.post('/', (req: Request, res: Response) => {
  try {
    const { name, url, scraper_type = 'generic' } = req.body as {
      name?: string;
      url?: string;
      scraper_type?: string;
    };

    if (!name || !url) {
      return res.status(400).json({ error: 'name and url are required' });
    }

    try { new URL(url); } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Auto-detect scraper type from URL
    let detectedType = scraper_type;
    if (url.includes('chefkoch.de')) detectedType = 'chefkoch';
    else if (url.includes('rewe.de')) detectedType = 'rewe';

    const validTypes = ['chefkoch', 'rewe', 'generic'];
    if (!validTypes.includes(detectedType)) {
      return res.status(400).json({ error: `scraper_type must be one of: ${validTypes.join(', ')}` });
    }

    try {
      const result = db.prepare(
        'INSERT INTO recipe_sources (name, url, scraper_type, status) VALUES (?, ?, ?, ?)',
      ).run(name, url, detectedType, 'active');

      const created = db.prepare('SELECT * FROM recipe_sources WHERE id = ?')
        .get(result.lastInsertRowid) as RawSource;
      res.status(201).json(serializeSource(created));
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        return res.status(409).json({ error: 'A source with this URL already exists' });
      }
      throw err;
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── DELETE /api/sources/:id ──────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const source = db.prepare('SELECT id FROM recipe_sources WHERE id = ?').get(req.params['id']);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    db.prepare('DELETE FROM recipe_sources WHERE id = ?').run(req.params['id']);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ─── POST /api/sources/:id/login ──────────────────────────────────────────────

router.post('/:id/login', async (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = db.prepare('SELECT * FROM recipe_sources WHERE id = ?')
    .get(sourceId) as RawSource | undefined;

  if (!source) return res.status(404).json({ error: 'Source not found' });

  const def = getSourceDefinition(source.scraper_type);

  if (!def.authConfig || !def.login) {
    return res.status(400).json({ error: 'This source does not support authentication' });
  }

  const credentials = req.body as Record<string, string>;

  // Validate that all required fields are present
  const missing = def.authConfig.fields
    .filter((f) => !credentials[f.key])
    .map((f) => f.label);

  if (missing.length > 0) {
    return res.status(400).json({ error: `Fehlende Felder: ${missing.join(', ')}` });
  }

  try {
    const authData = await def.login(credentials, source.url);

    db.prepare(`
      UPDATE recipe_sources SET
        auth_type    = ?,
        auth_data    = ?,
        auth_status  = 'authenticated',
        auth_error   = NULL,
        auth_username = ?
      WHERE id = ?
    `).run(
      def.authConfig ? 'cookie_login' : 'none',
      JSON.stringify(authData),
      authData.username ?? credentials['email'] ?? null,
      sourceId,
    );

    const updated = db.prepare('SELECT * FROM recipe_sources WHERE id = ?')
      .get(sourceId) as RawSource;
    res.json(serializeSource(updated));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Login fehlgeschlagen';

    db.prepare(`
      UPDATE recipe_sources SET
        auth_status = 'error',
        auth_error  = ?
      WHERE id = ?
    `).run(msg, sourceId);

    res.status(401).json({ error: msg });
  }
});

// ─── POST /api/sources/:id/logout ─────────────────────────────────────────────

router.post('/:id/logout', (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = db.prepare('SELECT id FROM recipe_sources WHERE id = ?').get(sourceId);

  if (!source) return res.status(404).json({ error: 'Source not found' });

  db.prepare(`
    UPDATE recipe_sources SET
      auth_data     = NULL,
      auth_type     = 'none',
      auth_status   = 'unauthenticated',
      auth_error    = NULL,
      auth_username = NULL
    WHERE id = ?
  `).run(sourceId);

  const updated = db.prepare('SELECT * FROM recipe_sources WHERE id = ?')
    .get(sourceId) as RawSource;
  res.json(serializeSource(updated));
});

// ─── POST /api/sources/:id/validate-session ───────────────────────────────────

router.post('/:id/validate-session', async (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = db.prepare('SELECT * FROM recipe_sources WHERE id = ?')
    .get(sourceId) as RawSource | undefined;

  if (!source) return res.status(404).json({ error: 'Source not found' });

  const def = getSourceDefinition(source.scraper_type);

  if (source.auth_status !== 'authenticated' || !source.auth_data) {
    return res.json({ valid: false });
  }

  if (!def.validateSession) {
    return res.json({ valid: true }); // assume still valid if no validator
  }

  try {
    const authData = JSON.parse(source.auth_data) as StoredAuthData;
    const valid = await def.validateSession(authData, source.url);

    if (!valid) {
      db.prepare(`
        UPDATE recipe_sources SET
          auth_status = 'error',
          auth_error  = 'Sitzung abgelaufen – bitte neu anmelden.'
        WHERE id = ?
      `).run(sourceId);
    }

    res.json({ valid });
  } catch {
    res.json({ valid: false });
  }
});

// ─── POST /api/sources/:id/sync ───────────────────────────────────────────────

router.post('/:id/sync', async (req: Request, res: Response) => {
  const sourceId = parseInt(req.params['id'], 10);
  const source = db.prepare('SELECT * FROM recipe_sources WHERE id = ?')
    .get(sourceId) as RawSource | undefined;

  if (!source) return res.status(404).json({ error: 'Source not found' });

  db.prepare('UPDATE recipe_sources SET status = ?, error_message = NULL WHERE id = ?')
    .run('syncing', sourceId);

  const limit = parseInt(String(req.query['limit'] || '10'), 10);

  // Resolve any stored auth headers for this source
  const def = getSourceDefinition(source.scraper_type);
  let extraHeaders: Record<string, string> = {};
  if (source.auth_status === 'authenticated' && source.auth_data && def.authHeaders) {
    try {
      const authData = JSON.parse(source.auth_data) as StoredAuthData;
      extraHeaders = def.authHeaders(authData);
    } catch { /* ignore corrupt auth data */ }
  }

  try {
    const recipeUrls = await discoverRecipeUrls(source.url, source.scraper_type, limit);

    const knownUrls = new Set(
      (db.prepare("SELECT source_url FROM recipes WHERE source_url != ''").all() as unknown as RawRecipe[])
        .map((r) => r.source_url),
    );

    const newUrls = recipeUrls.filter((u) => !knownUrls.has(u));

    const insertRecipe = db.prepare(`
      INSERT OR IGNORE INTO recipes
        (title, description, image_url, source_url, source_name, prep_time, cook_time, servings,
         dietary_tags, ingredients, instructions, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    const results: Array<{ url: string; status: 'success' | 'error'; error?: string; title?: string }> = [];

    for (const url of newUrls.slice(0, limit)) {
      try {
        let scraped;
        if (source.scraper_type === 'chefkoch') {
          scraped = await scrapeChefkoch(url, extraHeaders);
        } else if (source.scraper_type === 'rewe') {
          scraped = await scrapeRewe(url, extraHeaders);
        } else {
          scraped = await scrapeGeneric(url);
        }

        insertRecipe.run(
          scraped.title, scraped.description, scraped.image_url, url, source.name,
          scraped.prep_time, scraped.cook_time, scraped.servings,
          JSON.stringify(scraped.dietary_tags),
          JSON.stringify(scraped.ingredients),
          JSON.stringify(scraped.instructions),
        );

        results.push({ url, status: 'success', title: scraped.title });
        await sleep(500);
      } catch (err: unknown) {
        results.push({
          url,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;

    db.prepare(`
      UPDATE recipe_sources SET
        status        = 'active',
        last_sync     = datetime('now'),
        error_message = NULL
      WHERE id = ?
    `).run(sourceId);

    const updated = db.prepare('SELECT * FROM recipe_sources WHERE id = ?')
      .get(sourceId) as RawSource;

    res.json({
      source: serializeSource(updated),
      discovered: recipeUrls.length,
      new: newUrls.length,
      scraped: successCount,
      results,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Sync failed';
    db.prepare(`
      UPDATE recipe_sources SET status = 'error', error_message = ? WHERE id = ?
    `).run(errorMsg, sourceId);

    res.status(500).json({ error: errorMsg });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverRecipeUrls(
  baseUrl: string,
  scraperType: string,
  limit: number,
): Promise<string[]> {
  if (scraperType === 'chefkoch') return discoverChefkochUrls(baseUrl, limit);
  if (scraperType === 'rewe') return discoverReweUrls(baseUrl, limit);

  const urls = await tryGenericSitemap(baseUrl, limit);
  if (urls.length > 0) return urls;
  return discoverFromHomepage(baseUrl, limit);
}

async function tryGenericSitemap(baseUrl: string, limit: number): Promise<string[]> {
  const { protocol, host } = new URL(baseUrl);
  const sitemapUrls = [
    `${protocol}//${host}/sitemap.xml`,
    `${protocol}//${host}/sitemap-recipes.xml`,
    `${protocol}//${host}/recipes/sitemap.xml`,
  ];

  for (const sitemapUrl of sitemapUrls) {
    try {
      const response = await axios.get<string>(sitemapUrl, {
        timeout: 8000,
        headers: { 'User-Agent': 'MealMindBot/1.0' },
      });
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
    const response = await axios.get<string>(baseUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'MealMindBot/1.0' },
    });
    const $ = cheerio.load(response.data);
    const { protocol, host } = new URL(baseUrl);
    const baseOrigin = `${protocol}//${host}`;
    const urls = new Set<string>();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('rezept') || href.includes('recipe')) {
        const absolute = href.startsWith('http') ? href : `${baseOrigin}${href}`;
        urls.add(absolute.split('?')[0]);
      }
    });
    return [...urls].slice(0, limit);
  } catch {
    return [];
  }
}

export default router;
