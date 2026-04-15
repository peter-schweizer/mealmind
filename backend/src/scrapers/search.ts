/**
 * Meta-search: query external recipe platforms by search term and return
 * preview cards. Individual recipes are then imported on demand via the
 * existing /api/recipes/scrape endpoint.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

// Use a realistic browser UA to avoid basic bot-detection
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
};

// ─── Shared types ──────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  image_url?: string;
  description?: string;
  source_name: string;
  scraper_type: string;
  prep_time?: number;   // minutes
  rating?: number;      // 0-5
}

// ─── Utility helpers ───────────────────────────────────────────────────────────

/** Try to extract embedded Next.js / React page data from the HTML. */
function extractNextData(html: string): Record<string, unknown> | null {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Deep-find all objects in a JSON tree that satisfy a predicate. */
function deepFind<T>(
  obj: unknown,
  predicate: (o: Record<string, unknown>) => boolean,
  maxDepth = 12,
  depth = 0
): T[] {
  if (depth > maxDepth || obj === null || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    return obj.flatMap((item) => deepFind<T>(item, predicate, maxDepth, depth + 1));
  }
  const record = obj as Record<string, unknown>;
  const results: T[] = [];
  if (predicate(record)) results.push(record as unknown as T);
  for (const val of Object.values(record)) {
    results.push(...deepFind<T>(val, predicate, maxDepth, depth + 1));
  }
  return results;
}

// ─── Chefkoch search ───────────────────────────────────────────────────────────

interface ChefkochApiRecipe {
  title?: string;
  subtitle?: string;
  previewImageUrlTemplate?: string;
  siteUrl?: string;
  id?: string | number;
  rating?: { ratingValue?: number };
  totalTime?: string;
  difficulty?: string;
}

/** Top-level entry in the Chefkoch v2 search results array */
interface ChefkochApiResult {
  recipe?: ChefkochApiRecipe;
}

/**
 * Try Chefkoch's internal v2 search API first (fast, structured JSON),
 * fall back to HTML scraping of the search results page.
 */
export async function searchChefkoch(query: string, limit = 10): Promise<SearchResult[]> {
  // Attempt 1: Chefkoch public search API (used by their own frontend)
  try {
    const apiUrl =
      `https://api.chefkoch.de/v2/recipes?` +
      `query=${encodeURIComponent(query)}&limit=${limit}&offset=0&` +
      `order=3&permissions=3&viewType=0`;

    const { data } = await axios.get<{ results: ChefkochApiResult[] }>(apiUrl, {
      timeout: 10000,
      headers: { ...HEADERS, Accept: 'application/json' },
    });

    if (Array.isArray(data?.results) && data.results.length > 0) {
      const out: SearchResult[] = [];
      for (const entry of data.results.slice(0, limit)) {
        const r = entry.recipe;
        if (!r?.title) continue;

        // Image template: replace {size} with a usable resolution
        const imgTemplate = r.previewImageUrlTemplate ?? '';
        const image_url = imgTemplate
          ? imgTemplate.replace('<format>', 'crop-240x300').replace('{size}', 'crop-240x300')
          : undefined;

        const totalMinutes = r.totalTime ? parseDurationMins(r.totalTime) : undefined;

        out.push({
          title: r.title,
          url: r.siteUrl ?? `https://www.chefkoch.de/rezepte/${r.id ?? ''}/`,
          image_url,
          description: r.subtitle ?? undefined,
          source_name: 'Chefkoch',
          scraper_type: 'chefkoch',
          prep_time: totalMinutes,
          rating: r.rating?.ratingValue ? Math.round(r.rating.ratingValue) : undefined,
        });
      }
      if (out.length > 0) return out;
    }
  } catch {
    // API failed – fall through to HTML scraping
  }

  // Attempt 2: Chefkoch HTML search results page
  try {
    const searchUrl = `https://www.chefkoch.de/rs/s0/${encodeURIComponent(query)}/Rezepte.html`;
    const { data: html } = await axios.get<string>(searchUrl, {
      timeout: 15000,
      headers: HEADERS,
    });

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Try multiple selector strategies (Chefkoch updates their markup)
    const selectors = [
      'article.rsel-recipe',
      '[data-vars-tracking-recipe-id]',
      '.recipe-card',
      'article[class*="recipe"]',
    ];

    for (const selector of selectors) {
      const elements = $(selector);
      if (elements.length === 0) continue;

      elements.each((_, el) => {
        if (results.length >= limit) return false;
        const $el = $(el);

        const linkEl = $el.find('a[href*="/rezepte/"]').first();
        const href = linkEl.attr('href') ?? '';
        if (!href) return;

        const url = href.startsWith('http')
          ? href.split('?')[0]
          : `https://www.chefkoch.de${href.split('?')[0]}`;

        const title =
          $el.find('h3, h2, [class*="title"], [class*="heading"]').first().text().trim() ||
          linkEl.attr('title') ||
          '';
        if (!title) return;

        const imgEl = $el.find('img').first();
        const image_url =
          imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || undefined;

        const description = $el.find('[class*="description"], [class*="subtitle"], p').first().text().trim() || undefined;

        results.push({
          title,
          url,
          image_url: image_url && !image_url.includes('placeholder') ? image_url : undefined,
          description,
          source_name: 'Chefkoch',
          scraper_type: 'chefkoch',
        });
      });

      if (results.length > 0) break; // found something with this selector
    }

    // Attempt 3: scan for JSON-LD on the search page
    if (results.length === 0) {
      $('script[type="application/ld+json"]').each((_, el) => {
        if (results.length >= limit) return false;
        try {
          const json = JSON.parse($(el).html() ?? '');
          const items: ChefkochApiRecipe[] = Array.isArray(json)
            ? json
            : json['@graph']
            ? json['@graph']
            : [json];

          for (const item of items) {
            if (results.length >= limit) break;
            const r = item as Record<string, unknown>;
            if (r['@type'] !== 'Recipe') continue;
            results.push({
              title: String(r['name'] ?? ''),
              url: String(r['url'] ?? ''),
              image_url:
                typeof r['image'] === 'string'
                  ? r['image']
                  : Array.isArray(r['image'])
                  ? String((r['image'] as unknown[])[0] ?? '')
                  : undefined,
              description: String(r['description'] ?? '') || undefined,
              source_name: 'Chefkoch',
              scraper_type: 'chefkoch',
            });
          }
        } catch {
          // bad JSON – skip
        }
      });
    }

    return results;
  } catch {
    return [];
  }
}

// ─── REWE search ──────────────────────────────────────────────────────────────

interface ReweRecipeItem {
  id?: string | number;
  title?: string;
  name?: string;
  slug?: string;
  description?: string;
  image?: { src?: string; url?: string } | string;
  images?: Array<{ src?: string; url?: string }>;
  url?: string;
  link?: string;
  preparationTime?: number;
}

/**
 * Search REWE recipes. REWE uses a Next.js frontend, so we try to extract
 * embedded page data first, then fall back to HTML parsing.
 */
export async function searchRewe(query: string, limit = 10): Promise<SearchResult[]> {
  const searchUrl = `https://www.rewe.de/rezepte/suche/?query=${encodeURIComponent(query)}`;

  try {
    const { data: html } = await axios.get<string>(searchUrl, {
      timeout: 15000,
      headers: HEADERS,
    });

    // Attempt 1: parse Next.js __NEXT_DATA__
    const nextData = extractNextData(html);
    if (nextData) {
      // Find recipe-like objects in the page data
      const recipeObjs = deepFind<ReweRecipeItem>(
        nextData,
        (o) =>
          typeof o['title'] === 'string' &&
          (typeof o['slug'] === 'string' ||
            typeof o['url'] === 'string' ||
            typeof o['link'] === 'string')
      );

      if (recipeObjs.length > 0) {
        return recipeObjs.slice(0, limit).map((r): SearchResult => {
          const slug = r.slug ?? '';
          const url =
            r.url ||
            r.link ||
            (slug ? `https://www.rewe.de/rezepte/${slug}/` : '');

          const imgRaw = r.image || (Array.isArray(r.images) && r.images[0]);
          const image_url =
            typeof imgRaw === 'string'
              ? imgRaw
              : typeof imgRaw === 'object' && imgRaw
              ? imgRaw.src || imgRaw.url
              : undefined;

          return {
            title: r.title ?? r.name ?? '(ohne Titel)',
            url,
            image_url,
            description: r.description ?? undefined,
            source_name: 'REWE',
            scraper_type: 'rewe',
            prep_time: r.preparationTime ?? undefined,
          };
        });
      }
    }

    // Attempt 2: HTML parse
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    const selectors = [
      '[data-testid="recipe-card"]',
      'article[class*="recipe"]',
      '.recipe-card',
      'a[href*="/rezepte/"][href!="/rezepte/"]',
    ];

    for (const selector of selectors) {
      const elements = $(selector);
      if (elements.length === 0) continue;

      elements.each((_, el) => {
        if (results.length >= limit) return false;
        const $el = $(el);

        const href =
          $el.is('a') ? $el.attr('href') : $el.find('a[href*="/rezepte/"]').first().attr('href');
        if (!href) return;

        const url = href.startsWith('http')
          ? href.split('?')[0]
          : `https://www.rewe.de${href.split('?')[0]}`;

        const title =
          $el.find('h2, h3, [class*="title"], [class*="heading"]').first().text().trim() ||
          $el.attr('aria-label') ||
          '';
        if (!title) return;

        const imgEl = $el.find('img').first();
        const image_url =
          imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || undefined;

        results.push({
          title,
          url,
          image_url: image_url && !image_url.includes('placeholder') ? image_url : undefined,
          source_name: 'REWE',
          scraper_type: 'rewe',
        });
      });

      if (results.length > 0) break;
    }

    return results;
  } catch {
    return [];
  }
}

// ─── Combined search ───────────────────────────────────────────────────────────

export interface SearchOptions {
  sources?: string[];   // defaults to ['chefkoch', 'rewe']
  limit?: number;       // per source, defaults to 10
}

export async function searchAllSources(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const sources = options.sources ?? ['chefkoch', 'rewe'];
  const limit = Math.min(options.limit ?? 10, 30);

  const tasks: Promise<SearchResult[]>[] = [];
  if (sources.includes('chefkoch')) tasks.push(searchChefkoch(query, limit));
  if (sources.includes('rewe')) tasks.push(searchRewe(query, limit));

  const settled = await Promise.allSettled(tasks);
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse ISO 8601 duration (PT1H30M) or German strings ("1 Std. 30 Min.") into minutes. */
function parseDurationMins(raw: string): number | undefined {
  if (!raw) return undefined;
  // ISO 8601: PT1H30M / PT45M
  const iso = raw.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (iso) {
    const h = parseInt(iso[1] ?? '0', 10);
    const m = parseInt(iso[2] ?? '0', 10);
    return h * 60 + m || undefined;
  }
  // Fallback: plain number
  const plain = parseInt(raw, 10);
  return isNaN(plain) ? undefined : plain;
}
