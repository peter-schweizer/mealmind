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

async function checkRobotsRewe(url: string): Promise<void> {
  const robotsUrl = 'https://www.rewe.de/robots.txt';
  try {
    const response = await axios.get<string>(robotsUrl, {
      timeout: 5000,
      headers: { 'User-Agent': USER_AGENT },
    });
    const robots = robotsParser(robotsUrl, response.data);
    if (robots.isAllowed(url, 'MealMindBot') === false) {
      throw new Error(`REWE robots.txt disallows scraping of: ${url}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('robots.txt disallows')) throw err;
  }
}

/**
 * Parse a REWE JSON-LD node into our ScrapedRecipe format.
 */
function parseReweJsonLd(node: Record<string, unknown>): Partial<ScrapedRecipe> {
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
        const d = diet.toLowerCase();
        if (d.includes('vegan')) tags.push('vegan');
        else if (d.includes('vegetarian')) tags.push('vegetarisch');
        else if (d.includes('glutenfree')) tags.push('glutenfrei');
        else if (d.includes('dairyfree')) tags.push('laktosefrei');
      }
    }
    const keywords = getString('keywords');
    const kl = keywords.toLowerCase();
    if (kl.includes('vegan')) tags.push('vegan');
    if (kl.includes('vegetarisch')) tags.push('vegetarisch');
    if (kl.includes('glutenfrei')) tags.push('glutenfrei');
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
 * REWE-specific HTML fallback using their DOM structure.
 */
function parseReweHtml($: cheerio.CheerioAPI, url: string): Partial<ScrapedRecipe> {
  // REWE recipe page selectors (based on REWE's typical recipe structure)
  const title =
    $('h1[class*="recipe-title"], h1[class*="rTitle"], h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') || '';

  const description =
    $('[class*="recipe-description"], [class*="rDescription"]').first().text().trim() ||
    $('meta[name="description"]').attr('content') || '';

  const imageEl = $('[class*="recipe-image"] img, [class*="rImage"] img').first();
  const image_url =
    imageEl.attr('src') ||
    imageEl.attr('data-src') ||
    $('meta[property="og:image"]').attr('content') || '';

  // REWE ingredient structure: list items or table rows
  const ingredients: ParsedIngredient[] = [];
  $('[class*="ingredient"], [class*="zutat"], [class*="rIngredient"]').each((_, el) => {
    const amount = $(el).find('[class*="amount"], [class*="menge"]').text().trim();
    const name = $(el).find('[class*="name"], [class*="bezeichnung"]').text().trim();
    if (name) {
      const combined = amount ? `${amount} ${name}` : name;
      ingredients.push(parseIngredientString(combined));
    }
  });

  // Fallback: list items under ingredients section
  if (ingredients.length === 0) {
    $('[class*="ingredient-list"] li, [class*="ingredients"] li').each((_, el) => {
      const text = $(el).text().trim();
      if (text) ingredients.push(parseIngredientString(text));
    });
  }

  // REWE instructions: ordered list or numbered divs
  const instructions: string[] = [];
  $('[class*="preparation-step"], [class*="step"], [class*="rStep"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text) instructions.push(text);
  });

  if (instructions.length === 0) {
    $('[class*="preparation"] ol li, [class*="instructions"] ol li').each((_, el) => {
      const text = $(el).text().trim();
      if (text) instructions.push(text);
    });
  }

  // Servings
  const servingsText = $('[class*="portion"], [class*="servings"], [class*="yield"]').first().text();
  const servingsMatch = servingsText.match(/\d+/);
  const servings = servingsMatch ? parseInt(servingsMatch[0], 10) : 4;

  return {
    title,
    description: typeof description === 'string' ? description : '',
    image_url: image_url
      ? image_url.startsWith('http')
        ? image_url
        : new URL(image_url, url).toString()
      : '',
    ingredients,
    instructions,
    prep_time: 0,
    cook_time: 0,
    servings: isNaN(servings) ? 4 : servings,
    dietary_tags: [],
  };
}

/**
 * Scrape a REWE recipe page.
 */
export async function scrapeRewe(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<ScrapedRecipe> {
  if (!url.includes('rewe.de')) {
    throw new Error(`URL does not appear to be a REWE URL: ${url}`);
  }

  await checkRobotsRewe(url);

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

  // Try JSON-LD first
  let jsonLdData: Partial<ScrapedRecipe> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonLdData) return;
    const raw = $(el).html() || '';
    try {
      const parsed = JSON.parse(raw);
      const candidates: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed['@graph']
          ? parsed['@graph']
          : [parsed];
      for (const c of candidates) {
        const node = c as Record<string, unknown>;
        const type = node['@type'];
        const isRecipe =
          (typeof type === 'string' && type.toLowerCase().includes('recipe')) ||
          (Array.isArray(type) && (type as string[]).some(t => t.toLowerCase().includes('recipe')));
        if (isRecipe) {
          jsonLdData = parseReweJsonLd(node);
          break;
        }
      }
    } catch {
      // skip malformed JSON-LD
    }
  });

  const htmlData = parseReweHtml($, url);

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
    throw new Error(`Could not extract recipe title from REWE URL: ${url}`);
  }

  return merged;
}

/**
 * Discover recipe URLs from the REWE recipe index page.
 */
export async function discoverReweUrls(baseUrl: string, limit = 10): Promise<string[]> {
  const response = await axios.get<string>(baseUrl, {
    timeout: 15000,
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de-DE,de;q=0.9' },
  });

  const $ = cheerio.load(response.data);
  const urls = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    // REWE recipe URLs typically contain /rezepte/ path
    if (/\/rezepte\/[a-z0-9-]+\/?$/.test(href) && !href.includes('#')) {
      const absolute = href.startsWith('http')
        ? href
        : `https://www.rewe.de${href}`;
      urls.add(absolute.split('?')[0]);
    }
  });

  return [...urls].slice(0, limit);
}
