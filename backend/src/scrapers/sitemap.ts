/**
 * Sitemap-based recipe URL discovery.
 *
 * Pipeline:
 *   1. Fetch robots.txt  → respect Disallow rules + extract Sitemap: directives
 *   2. Probe known sitemap locations
 *   3. Parse XML (flat sitemap or sitemap index — recursive, max 2 levels)
 *   4. Filter by recipe URL patterns
 *   5. Return deduplicated, robots.txt-approved URLs
 *
 * Standards used:
 *   - Sitemaps protocol  https://www.sitemaps.org/protocol.html  (open standard)
 *   - robots.txt         https://www.robotstxt.org/              (open standard)
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser, { type Robot } from 'robots-parser';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MINER_UA = 'MealMindBot/1.0 (private recipe aggregator; https://mealmind.app)';

/** Delay between HTTP requests in milliseconds — be polite. */
const REQUEST_DELAY_MS = 2_000;

/** Maximum number of child sitemaps to follow inside a sitemap index. */
const MAX_CHILD_SITEMAPS = 50;

/** Maximum recursion depth for nested sitemap indexes. */
const MAX_SITEMAP_DEPTH = 2;

/** Timeout for a single HTTP request. */
const REQUEST_TIMEOUT_MS = 12_000;

// ─── URL patterns that indicate a recipe page ─────────────────────────────────

const RECIPE_URL_PATTERNS = [
  /\/rezepte?\//i,
  /\/recipe[s]?\//i,
  /\/kochen\//i,
  /[/-]rezept[/-]/i,
  /[/-]recipe[/-]/i,
];

// URL patterns that definitely do NOT point to a recipe page
const NON_RECIPE_PATTERNS = [
  /\/(kategorie|category|tag|autor|author|suche|search|login|account|cart|shop)\//i,
  /\.(jpg|jpeg|png|gif|svg|webp|pdf|xml|rss|atom)$/i,
];

function looksLikeRecipeUrl(url: string): boolean {
  if (NON_RECIPE_PATTERNS.some((p) => p.test(url))) return false;
  return RECIPE_URL_PATTERNS.some((p) => p.test(url));
}

// ─── robots.txt cache (per hostname, valid for the duration of a sync run) ────

const robotsCache = new Map<string, Robot>();

async function getRobots(origin: string): Promise<Robot> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;

  const robotsUrl = `${origin}/robots.txt`;
  try {
    const { data } = await axios.get<string>(robotsUrl, {
      timeout: 8_000,
      headers: { 'User-Agent': MINER_UA },
      responseType: 'text',
    });
    const robots = robotsParser(robotsUrl, data);
    robotsCache.set(origin, robots);
    return robots;
  } catch {
    // If robots.txt is unreachable, treat everything as allowed
    const permissive = robotsParser(robotsUrl, '');
    robotsCache.set(origin, permissive);
    return permissive;
  }
}

/** Returns true when MealMindBot is allowed to fetch this URL. */
async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const { origin } = new URL(url);
    const robots = await getRobots(origin);
    return robots.isAllowed(url, 'MealMindBot') !== false;
  } catch {
    return true; // malformed URL → skip silently upstream
  }
}

/** Extract "Sitemap:" directives declared inside robots.txt. */
async function getSitemapDirectives(origin: string): Promise<string[]> {
  try {
    const robots = await getRobots(origin);
    const sitemaps = robots.getSitemaps();
    return Array.isArray(sitemaps) ? sitemaps : [];
  } catch {
    return [];
  }
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fetches a URL with rate limiting and a polite User-Agent. */
async function politeGet(url: string, delayMs = REQUEST_DELAY_MS): Promise<string> {
  await sleep(delayMs);
  const { data } = await axios.get<string>(url, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'User-Agent': MINER_UA, Accept: 'text/html,application/xml,text/xml,*/*' },
    responseType: 'text',
    maxRedirects: 5,
  });
  return data;
}

// ─── Sitemap parser ───────────────────────────────────────────────────────────

interface SitemapParseResult {
  /** Leaf-level page URLs found in <url><loc> elements. */
  pageUrls: string[];
  /** Child sitemap URLs found in <sitemapindex><sitemap><loc> elements. */
  childSitemapUrls: string[];
}

function parseSitemapXml(xml: string): SitemapParseResult {
  const $ = cheerio.load(xml, { xmlMode: true });
  const pageUrls: string[] = [];
  const childSitemapUrls: string[] = [];

  // Sitemap index — child sitemaps
  $('sitemapindex sitemap loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) childSitemapUrls.push(loc);
  });

  // Regular sitemap — page URLs
  $('urlset url loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) pageUrls.push(loc);
  });

  // Some sitemaps omit the namespace wrapper — fall back to bare <loc> tags
  if (pageUrls.length === 0 && childSitemapUrls.length === 0) {
    $('loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (loc && loc.endsWith('.xml')) childSitemapUrls.push(loc);
      else if (loc) pageUrls.push(loc);
    });
  }

  return { pageUrls, childSitemapUrls };
}

/**
 * Recursively fetch and parse a sitemap URL.
 * Returns all leaf page URLs found (filtered to recipe pages only).
 */
async function crawlSitemap(
  sitemapUrl: string,
  depth = 0,
  visited = new Set<string>(),
  maxRecipes = 500,
): Promise<string[]> {
  if (depth > MAX_SITEMAP_DEPTH) return [];
  if (visited.has(sitemapUrl)) return [];
  visited.add(sitemapUrl);

  // Respect robots.txt even for sitemap files
  if (!(await isAllowedByRobots(sitemapUrl))) {
    console.log(`[sitemap] robots.txt disallows: ${sitemapUrl}`);
    return [];
  }

  let xml: string;
  try {
    xml = await politeGet(sitemapUrl, depth === 0 ? 0 : REQUEST_DELAY_MS);
  } catch (err) {
    console.warn(`[sitemap] Failed to fetch ${sitemapUrl}:`, (err as Error).message);
    return [];
  }

  const { pageUrls, childSitemapUrls } = parseSitemapXml(xml);

  // Collect recipe URLs from this level
  const recipeUrls = pageUrls.filter(looksLikeRecipeUrl);

  // Follow child sitemaps
  const childUrls: string[] = [];
  for (const child of childSitemapUrls.slice(0, MAX_CHILD_SITEMAPS)) {
    if (recipeUrls.length + childUrls.length >= maxRecipes) break;
    const found = await crawlSitemap(child, depth + 1, visited, maxRecipes);
    childUrls.push(...found);
  }

  return [...recipeUrls, ...childUrls];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface SitemapDiscoveryOptions {
  /** Maximum recipe URLs to return. Default 500. */
  maxUrls?: number;
  /** Extra sitemap URLs to try (e.g. from source config). */
  extraSitemaps?: string[];
}

/**
 * Discover recipe URLs for a given source website using its sitemap.
 *
 * Steps:
 *   1. Read robots.txt — extract Sitemap: directives, check permission
 *   2. Try sitemap URLs: from robots.txt, then common locations
 *   3. Recursively parse (sitemap index → child sitemaps → pages)
 *   4. Filter by recipe URL pattern
 *   5. Deduplicate & return
 */
export async function discoverViaSitemap(
  sourceUrl: string,
  options: SitemapDiscoveryOptions = {},
): Promise<string[]> {
  const maxUrls = options.maxUrls ?? 500;
  const { origin } = new URL(sourceUrl);

  // Clear per-run cache so fresh robots.txt is fetched each sync
  robotsCache.delete(origin);

  // Candidate sitemap URLs in priority order
  const candidates: string[] = [
    ...(options.extraSitemaps ?? []),
    ...(await getSitemapDirectives(origin)),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-recipes.xml`,
    `${origin}/sitemap/recipes.xml`,
    `${origin}/rezepte/sitemap.xml`,
  ];

  // Deduplicate candidates
  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  const allUrls = new Set<string>();
  const visitedSitemaps = new Set<string>();

  for (const sitemapUrl of uniqueCandidates) {
    if (allUrls.size >= maxUrls) break;
    const urls = await crawlSitemap(sitemapUrl, 0, visitedSitemaps, maxUrls - allUrls.size);
    for (const u of urls) {
      if (allUrls.size >= maxUrls) break;
      allUrls.add(u);
    }
    if (allUrls.size > 0) break; // found recipes — stop trying other candidates
  }

  console.log(`[sitemap] Discovered ${allUrls.size} recipe URLs from ${sourceUrl}`);
  return [...allUrls];
}

/**
 * Quick check: does a URL appear to be a recipe page?
 * Exported so the sync route can apply the same filter to homepage links.
 */
export { looksLikeRecipeUrl };

/** Clear the robots.txt cache (useful in tests). */
export function clearRobotsCache(): void {
  robotsCache.clear();
}
