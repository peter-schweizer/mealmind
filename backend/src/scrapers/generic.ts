import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';

export interface ParsedIngredient {
  amount: number | '';
  unit: string;
  item: string;
}

export interface ScrapedRecipe {
  title: string;
  description: string;
  image_url: string;
  ingredients: ParsedIngredient[];
  instructions: string[];
  prep_time: number;
  cook_time: number;
  servings: number;
  dietary_tags: string[];
}

// ─── Unit normalization map ──────────────────────────────────────────────────

const UNITS = [
  'kg', 'g', 'mg',
  'l', 'ml', 'cl', 'dl',
  'EL', 'TL', 'Tasse', 'Tassen',
  'Stück', 'Stk', 'Stk.',
  'Zehe', 'Zehen',
  'Bund', 'Prise', 'Prisen',
  'Packung', 'Pkg', 'Pck',
  'Dose',
  'Scheibe', 'Scheiben',
  'Zweig', 'Zweige',
  'Blatt', 'Blätter',
];

const UNIT_PATTERN = new RegExp(
  `^(\\d+[\\.,]?\\d*)\\s*(${UNITS.join('|')})\\.?\\s+(.+)$`,
  'i',
);

const FRACTION_MAP: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 0.333,
  '⅔': 0.667,
};

/**
 * Parse a raw ingredient string like "200 g Mehl" into structured form.
 */
export function parseIngredientString(str: string): ParsedIngredient {
  const trimmed = str.trim();

  // Replace unicode fractions
  let normalized = trimmed;
  for (const [frac, val] of Object.entries(FRACTION_MAP)) {
    normalized = normalized.replace(frac, String(val));
  }
  // Normalize decimal comma
  normalized = normalized.replace(/(\d),(\d)/g, '$1.$2');

  const match = normalized.match(UNIT_PATTERN);
  if (match) {
    return {
      amount: parseFloat(match[1]),
      unit: match[2],
      item: match[3].trim(),
    };
  }

  // Try: number at start, no unit
  const numOnlyMatch = normalized.match(/^(\d+[\.,]?\d*)\s+(.+)$/);
  if (numOnlyMatch) {
    return {
      amount: parseFloat(numOnlyMatch[1].replace(',', '.')),
      unit: '',
      item: numOnlyMatch[2].trim(),
    };
  }

  // No number found — treat entire string as the item
  return { amount: '', unit: '', item: trimmed };
}

/**
 * Parse ISO 8601 duration string like "PT30M", "PT1H20M" → minutes.
 */
export function parseDuration(iso: string): number {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  return hours * 60 + minutes;
}

/**
 * Check robots.txt for the given URL. Throws if scraping is disallowed.
 */
async function checkRobots(pageUrl: string): Promise<void> {
  const { protocol, host } = new URL(pageUrl);
  const robotsUrl = `${protocol}//${host}/robots.txt`;

  try {
    const response = await axios.get<string>(robotsUrl, { timeout: 5000 });
    const robots = robotsParser(robotsUrl, response.data);
    const allowed = robots.isAllowed(pageUrl, 'MealMindBot');
    if (allowed === false) {
      throw new Error(`Scraping disallowed by robots.txt for URL: ${pageUrl}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('Scraping disallowed')) {
      throw err;
    }
    // If robots.txt is unreachable, we continue (fail open)
  }
}

/**
 * Try to extract recipe data from JSON-LD schema.org/Recipe markup.
 */
function extractJsonLd(html: string): Partial<ScrapedRecipe> | null {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]');

  for (let i = 0; i < scripts.length; i++) {
    const raw = $(scripts[i]).html() || '';
    try {
      const parsed = JSON.parse(raw);
      const candidates: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed['@graph']
          ? parsed['@graph']
          : [parsed];

      for (const candidate of candidates) {
        const node = candidate as Record<string, unknown>;
        if (
          typeof node['@type'] === 'string' &&
          node['@type'].toLowerCase().includes('recipe')
        ) {
          return parseJsonLdRecipe(node);
        }
        if (Array.isArray(node['@type']) &&
          (node['@type'] as string[]).some(t => t.toLowerCase().includes('recipe'))) {
          return parseJsonLdRecipe(node);
        }
      }
    } catch {
      // skip malformed JSON-LD
    }
  }
  return null;
}

function parseJsonLdRecipe(node: Record<string, unknown>): Partial<ScrapedRecipe> {
  const getString = (key: string): string => {
    const val = node[key];
    if (typeof val === 'string') return val;
    if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
    return '';
  };

  const getImage = (): string => {
    const img = node['image'];
    if (typeof img === 'string') return img;
    if (Array.isArray(img)) {
      const first = img[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') return (first as Record<string, string>)['url'] || '';
    }
    if (img && typeof img === 'object') return (img as Record<string, string>)['url'] || '';
    return '';
  };

  const getInstructions = (): string[] => {
    const raw = node['recipeInstructions'];
    if (!raw) return [];
    if (typeof raw === 'string') {
      return raw.split(/\n|\r\n/).map(s => s.trim()).filter(Boolean);
    }
    if (Array.isArray(raw)) {
      return (raw as unknown[]).map(step => {
        if (typeof step === 'string') return step.trim();
        if (step && typeof step === 'object') {
          const s = step as Record<string, string>;
          return (s['text'] || s['name'] || '').trim();
        }
        return '';
      }).filter(Boolean);
    }
    return [];
  };

  const getIngredients = (): ParsedIngredient[] => {
    const raw = node['recipeIngredient'];
    if (!Array.isArray(raw)) return [];
    return (raw as string[]).map(s => parseIngredientString(s));
  };

  const getServings = (): number => {
    const raw = node['recipeYield'];
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const m = raw.match(/\d+/);
      if (m) return parseInt(m[0], 10);
    }
    if (Array.isArray(raw) && raw.length > 0) {
      const m = String(raw[0]).match(/\d+/);
      if (m) return parseInt(m[0], 10);
    }
    return 4;
  };

  const getDietaryTags = (): string[] => {
    const tags: string[] = [];
    const suitableFor = node['suitableForDiet'];
    if (Array.isArray(suitableFor)) {
      for (const diet of suitableFor as string[]) {
        if (diet.includes('Vegan')) tags.push('vegan');
        else if (diet.includes('Vegetarian')) tags.push('vegetarisch');
        else if (diet.includes('GlutenFree')) tags.push('glutenfrei');
        else if (diet.includes('DairyFree')) tags.push('laktosefrei');
      }
    }
    return tags;
  };

  return {
    title: getString('name'),
    description: getString('description'),
    image_url: getImage(),
    ingredients: getIngredients(),
    instructions: getInstructions(),
    prep_time: parseDuration(getString('prepTime')),
    cook_time: parseDuration(getString('cookTime') || getString('totalTime')),
    servings: getServings(),
    dietary_tags: getDietaryTags(),
  };
}

/**
 * Heuristic HTML parsing fallback using cheerio.
 */
function extractHeuristic(html: string, url: string): Partial<ScrapedRecipe> {
  const $ = cheerio.load(html);

  const title =
    $('h1').first().text().trim() ||
    $('[class*="recipe-title"], [class*="recipe_title"], [itemprop="name"]').first().text().trim() ||
    $('title').text().trim();

  const description =
    $('[itemprop="description"]').first().text().trim() ||
    $('[class*="recipe-desc"], [class*="recipe_desc"], [class*="description"]').first().text().trim() ||
    $('meta[name="description"]').attr('content') || '';

  const image_url =
    $('[itemprop="image"]').attr('src') ||
    $('[class*="recipe-image"] img, [class*="recipe_image"] img').first().attr('src') ||
    $('meta[property="og:image"]').attr('content') || '';

  // Instructions
  const instructionSelectors = [
    '[itemprop="recipeInstructions"] li',
    '[class*="instruction"] li',
    '[class*="step"] li',
    '.steps li',
    '[class*="preparation"] li',
    '[class*="directions"] li',
  ];
  let instructions: string[] = [];
  for (const sel of instructionSelectors) {
    const items: string[] = [];
    $(sel).each((_, el) => {
      const text = $(el).text().trim();
      if (text) items.push(text);
    });
    if (items.length > 0) {
      instructions = items;
      break;
    }
  }

  // Ingredients
  const ingredientSelectors = [
    '[itemprop="recipeIngredient"]',
    '[class*="ingredient"] li',
    '.ingredients li',
  ];
  let ingredientStrings: string[] = [];
  for (const sel of ingredientSelectors) {
    const items: string[] = [];
    $(sel).each((_, el) => {
      const text = $(el).text().trim();
      if (text) items.push(text);
    });
    if (items.length > 0) {
      ingredientStrings = items;
      break;
    }
  }
  const ingredients = ingredientStrings.map(parseIngredientString);

  return {
    title,
    description: typeof description === 'string' ? description : '',
    image_url: image_url ? new URL(image_url, url).toString() : '',
    ingredients,
    instructions,
    prep_time: 0,
    cook_time: 0,
    servings: 4,
    dietary_tags: [],
  };
}

/**
 * Generic scraper: checks robots.txt, fetches page, tries JSON-LD then heuristics.
 */
export async function scrapeGeneric(url: string): Promise<ScrapedRecipe> {
  await checkRobots(url);

  const response = await axios.get<string>(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'MealMindBot/1.0 (recipe aggregator; contact@mealmind.app)',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
    },
  });

  const html = response.data;

  // Try JSON-LD first
  const jsonLdData = extractJsonLd(html);

  // Merge with heuristic fallback for missing fields
  const heuristic = extractHeuristic(html, url);

  const merged: ScrapedRecipe = {
    title: (jsonLdData?.title || heuristic.title || '').substring(0, 255),
    description: jsonLdData?.description || heuristic.description || '',
    image_url: jsonLdData?.image_url || heuristic.image_url || '',
    ingredients: (jsonLdData?.ingredients && jsonLdData.ingredients.length > 0)
      ? jsonLdData.ingredients
      : (heuristic.ingredients || []),
    instructions: (jsonLdData?.instructions && jsonLdData.instructions.length > 0)
      ? jsonLdData.instructions
      : (heuristic.instructions || []),
    prep_time: jsonLdData?.prep_time ?? heuristic.prep_time ?? 0,
    cook_time: jsonLdData?.cook_time ?? heuristic.cook_time ?? 0,
    servings: jsonLdData?.servings || heuristic.servings || 4,
    dietary_tags: jsonLdData?.dietary_tags || heuristic.dietary_tags || [],
  };

  if (!merged.title) {
    throw new Error(`Could not extract recipe title from ${url}`);
  }

  return merged;
}
