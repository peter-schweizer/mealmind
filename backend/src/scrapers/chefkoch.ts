import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import {
  ScrapedRecipe,
  ParsedIngredient,
  parseIngredientString,
  parseDuration,
} from './generic';

const USER_AGENT = 'MealMindBot/1.0 (recipe aggregator; contact@mealmind.app)';

async function checkRobotsChefkoch(url: string): Promise<void> {
  const robotsUrl = 'https://www.chefkoch.de/robots.txt';
  try {
    const response = await axios.get<string>(robotsUrl, { timeout: 5000, headers: { 'User-Agent': USER_AGENT } });
    const robots = robotsParser(robotsUrl, response.data);
    if (robots.isAllowed(url, 'MealMindBot') === false) {
      throw new Error(`Chefkoch robots.txt disallows scraping of: ${url}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('robots.txt disallows')) throw err;
  }
}

/**
 * Parse a Chefkoch JSON-LD node into our ScrapedRecipe format.
 */
function parseChefkochJsonLd(node: Record<string, unknown>): Partial<ScrapedRecipe> {
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

  const getIngredients = (): ParsedIngredient[] => {
    const raw = node['recipeIngredient'];
    if (!Array.isArray(raw)) return [];
    return (raw as string[]).map(s => parseIngredientString(s));
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

  const getServings = (): number => {
    const raw = node['recipeYield'];
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const m = raw.match(/\d+/);
      return m ? parseInt(m[0], 10) : 4;
    }
    if (Array.isArray(raw)) {
      const m = String(raw[0]).match(/\d+/);
      return m ? parseInt(m[0], 10) : 4;
    }
    return 4;
  };

  const getDietaryTags = (): string[] => {
    const tags: string[] = [];
    const suitableFor = node['suitableForDiet'];
    if (Array.isArray(suitableFor)) {
      for (const diet of suitableFor as string[]) {
        if (diet.toLowerCase().includes('vegan')) tags.push('vegan');
        else if (diet.toLowerCase().includes('vegetarian')) tags.push('vegetarisch');
        else if (diet.toLowerCase().includes('glutenfree')) tags.push('glutenfrei');
        else if (diet.toLowerCase().includes('dairyfree')) tags.push('laktosefrei');
      }
    }
    // Also check keywords
    const keywords = getString('keywords');
    if (keywords.toLowerCase().includes('vegan')) tags.push('vegan');
    if (keywords.toLowerCase().includes('vegetarisch')) tags.push('vegetarisch');
    return [...new Set(tags)];
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
 * Chefkoch-specific HTML fallback parsing using their DOM structure.
 */
function parseChefkochHtml($: ReturnType<typeof cheerio.load>, url: string): Partial<ScrapedRecipe> {
  const title = $('h1[class*="ds-heading"]').first().text().trim() ||
    $('h1').first().text().trim();

  const description = $('[class*="ds-text-prose"]').first().text().trim() ||
    $('meta[name="description"]').attr('content') || '';

  const imageEl = $('[class*="recipe-image"] img, [class*="ds-image"] img').first();
  const image_url = imageEl.attr('src') || imageEl.attr('data-src') ||
    $('meta[property="og:image"]').attr('content') || '';

  // Chefkoch ingredient table: amount in td.ds-col-2 or td-left, name in td.ds-col-10 or td-right
  const ingredients: ParsedIngredient[] = [];
  $('tr[class*="ingredient"], tr[class*="zutat"]').each((_, row) => {
    const amountText = $(row).find('td').first().text().trim();
    const nameText = $(row).find('td').last().text().trim();
    if (nameText) {
      const combined = amountText ? `${amountText} ${nameText}` : nameText;
      ingredients.push(parseIngredientString(combined));
    }
  });

  // If table approach didn't work, try data attributes
  if (ingredients.length === 0) {
    $('[class*="ingredient-amount"], [class*="ingredient-name"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text) ingredients.push(parseIngredientString(text));
    });
  }

  // Instructions: Chefkoch typically has a single textarea or divs
  const instructions: string[] = [];
  const prepText = $('[class*="recipe-preparation"], [class*="ds-box"] .ds-text').text().trim();
  if (prepText) {
    prepText.split(/\d+\.\s+/).filter(Boolean).forEach(s => {
      const clean = s.trim();
      if (clean) instructions.push(clean);
    });
  }

  // Servings from the portions input
  const portionsVal = $('[name="portions"], [id*="portions"], [class*="portions"]').first().val();
  const servings = portionsVal ? parseInt(String(portionsVal), 10) : 4;

  return {
    title,
    description: typeof description === 'string' ? description : '',
    image_url: image_url ? (image_url.startsWith('http') ? image_url : new URL(image_url, url).toString()) : '',
    ingredients,
    instructions,
    prep_time: 0,
    cook_time: 0,
    servings: isNaN(servings) ? 4 : servings,
    dietary_tags: [],
  };
}

/**
 * Scrape a Chefkoch recipe page.
 */
export async function scrapeChefkoch(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<ScrapedRecipe> {
  if (!url.includes('chefkoch.de')) {
    throw new Error(`URL does not appear to be a Chefkoch URL: ${url}`);
  }

  await checkRobotsChefkoch(url);

  const response = await axios.get<string>(url, {
    timeout: 15000,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'de-DE,de;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...extraHeaders,
    },
  });

  const html = response.data;
  const $ = cheerio.load(html);

  // Try JSON-LD first (Chefkoch uses it)
  let jsonLdData: Partial<ScrapedRecipe> | null = null;
  const scriptEls = $('script[type="application/ld+json"]').toArray();
  for (const el of scriptEls) {
    if (jsonLdData) break;
    const raw = $(el).html() || '';
    try {
      const parsed = JSON.parse(raw) as unknown;
      const candidates: unknown[] = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>)['@graph']
          ? (parsed as Record<string, unknown>)['@graph'] as unknown[]
          : [parsed];
      for (const c of candidates) {
        const node = c as Record<string, unknown>;
        const type = node['@type'];
        const isRecipe =
          (typeof type === 'string' && type.toLowerCase().includes('recipe')) ||
          (Array.isArray(type) && (type as string[]).some(t => t.toLowerCase().includes('recipe')));
        if (isRecipe) {
          jsonLdData = parseChefkochJsonLd(node);
          break;
        }
      }
    } catch {
      // skip malformed JSON-LD
    }
  }

  const htmlData: Partial<ScrapedRecipe> = parseChefkochHtml($, url);

  const merged: ScrapedRecipe = {
    title: (jsonLdData?.title || htmlData.title || '').substring(0, 255),
    description: jsonLdData?.description || htmlData.description || '',
    image_url: jsonLdData?.image_url || htmlData.image_url || '',
    ingredients: (jsonLdData?.ingredients && jsonLdData.ingredients.length > 0)
      ? jsonLdData.ingredients
      : (htmlData.ingredients || []),
    instructions: (jsonLdData?.instructions && jsonLdData.instructions.length > 0)
      ? jsonLdData.instructions
      : (htmlData.instructions || []),
    prep_time: jsonLdData?.prep_time ?? htmlData.prep_time ?? 0,
    cook_time: jsonLdData?.cook_time ?? htmlData.cook_time ?? 0,
    servings: jsonLdData?.servings || htmlData.servings || 4,
    dietary_tags: jsonLdData?.dietary_tags || htmlData.dietary_tags || [],
  };

  if (!merged.title) {
    throw new Error(`Could not extract recipe title from Chefkoch URL: ${url}`);
  }

  return merged;
}

/**
 * Discover recipe URLs from the Chefkoch homepage or a search/category page.
 */
export async function discoverChefkochUrls(baseUrl: string, limit = 10): Promise<string[]> {
  const response = await axios.get<string>(baseUrl, {
    timeout: 15000,
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de-DE,de;q=0.9' },
  });

  const $ = cheerio.load(response.data);
  const urls = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    // Chefkoch recipe URLs: /rezepte/NNNNN/
    if (/\/rezepte\/\d+\//.test(href)) {
      const absolute = href.startsWith('http')
        ? href
        : `https://www.chefkoch.de${href}`;
      urls.add(absolute.split('?')[0]); // strip query params
    }
  });

  return [...urls].slice(0, limit);
}
