/**
 * Universal Schema.org Recipe extractor via JSON-LD.
 *
 * Standard: https://schema.org/Recipe  (W3C open standard)
 *
 * Nearly every major recipe website embeds structured data in
 * <script type="application/ld+json"> blocks.  Extracting from
 * that structured data is:
 *   - More reliable than HTML scraping (publishers maintain it)
 *   - Language-agnostic (same code works for Chefkoch, REWE, BBC, etc.)
 *   - Legally unambiguous (the data is published for machine consumption)
 *
 * This module makes NO site-specific assumptions.
 */

import * as cheerio from 'cheerio';
import type { ScrapedRecipe, ParsedIngredient } from './generic';
import { parseIngredientString, parseDuration } from './generic';

// ─── Schema.org Recipe shape (partial) ───────────────────────────────────────

interface SchemaRecipe {
  '@type'?: string | string[];
  name?: string;
  description?: string;
  image?: string | string[] | { url?: string } | Array<{ url?: string }>;
  recipeIngredient?: string[];
  recipeInstructions?: unknown;
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  recipeYield?: string | string[] | number;
  recipeCategory?: string | string[];
  keywords?: string | string[];
  nutrition?: { calories?: string };
  author?: { name?: string } | string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getType(node: SchemaRecipe): string {
  if (Array.isArray(node['@type'])) return node['@type'].join(',');
  return String(node['@type'] ?? '');
}

function isRecipeNode(node: unknown): node is SchemaRecipe {
  if (!node || typeof node !== 'object') return false;
  const type = getType(node as SchemaRecipe);
  return type.toLowerCase().includes('recipe');
}

/**
 * Deep-scan a parsed JSON value for Schema.org Recipe nodes.
 * Handles @graph arrays, arrays of objects, and nested structures.
 */
function findRecipeNodes(value: unknown, depth = 0): SchemaRecipe[] {
  if (depth > 8 || value === null || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => findRecipeNodes(item, depth + 1));
  }

  const obj = value as Record<string, unknown>;

  if (isRecipeNode(obj)) return [obj as SchemaRecipe];

  // Check @graph
  if (Array.isArray(obj['@graph'])) {
    return findRecipeNodes(obj['@graph'], depth + 1);
  }

  // Recurse into object values (e.g. nested @context blocks)
  return Object.values(obj).flatMap((v) => findRecipeNodes(v, depth + 1));
}

function extractImage(image: SchemaRecipe['image']): string {
  if (!image) return '';
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) {
    const first = image[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') return (first as { url?: string }).url ?? '';
  }
  if (typeof image === 'object') return (image as { url?: string }).url ?? '';
  return '';
}

function extractInstructions(raw: unknown): string[] {
  if (!raw) return [];

  // Plain string — split on newlines
  if (typeof raw === 'string') {
    return raw.split(/\n|\r\n/).map((s) => s.trim()).filter(Boolean);
  }

  // Array of strings or HowToStep objects
  if (Array.isArray(raw)) {
    return raw.flatMap((item): string[] => {
      if (typeof item === 'string') return [item.trim()].filter(Boolean);
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        // HowToStep
        const text = String(obj['text'] ?? obj['name'] ?? '').trim();
        if (text) return [text];
        // HowToSection containing itemListElement
        if (Array.isArray(obj['itemListElement'])) {
          return extractInstructions(obj['itemListElement']);
        }
      }
      return [];
    });
  }

  return [];
}

function extractServings(raw: SchemaRecipe['recipeYield']): number {
  if (!raw) return 0;
  const str = Array.isArray(raw) ? String(raw[0]) : String(raw);
  const match = str.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

const DIETARY_KEYWORDS: Record<string, RegExp> = {
  Vegan: /\bvegan\b/i,
  Vegetarisch: /\bvegetar/i,
  Glutenfrei: /\bgluten.?frei\b|\bgluten.?free\b/i,
  Laktosefrei: /\blaktose.?frei\b|\bdairy.?free\b/i,
  'Low Carb': /\blow.?carb\b/i,
  Keto: /\bketo\b/i,
  Hochprotein: /\bhigh.?protein\b|\bhochprotein\b/i,
};

function inferDietaryTags(recipe: SchemaRecipe): string[] {
  const haystack = [
    recipe.name ?? '',
    recipe.description ?? '',
    ...(Array.isArray(recipe.recipeCategory) ? recipe.recipeCategory : [String(recipe.recipeCategory ?? '')]),
    ...(Array.isArray(recipe.keywords) ? recipe.keywords : [String(recipe.keywords ?? '')]),
  ].join(' ').toLowerCase();

  return Object.entries(DIETARY_KEYWORDS)
    .filter(([, pattern]) => pattern.test(haystack))
    .map(([tag]) => tag);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface JsonLdExtractionResult {
  recipe: ScrapedRecipe;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Extract a recipe from a page's HTML via Schema.org JSON-LD.
 *
 * Returns null if no Recipe node is found.
 *
 * Confidence levels:
 *   high   — title + ingredients + instructions all present
 *   medium — title + ingredients OR instructions present
 *   low    — only title found
 */
export function extractJsonLdRecipe(html: string, _pageUrl?: string): JsonLdExtractionResult | null {
  const $ = cheerio.load(html);

  const recipeNodes: SchemaRecipe[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html() ?? '';
      const parsed = JSON.parse(raw) as unknown;
      recipeNodes.push(...findRecipeNodes(parsed));
    } catch {
      // Malformed JSON — skip
    }
  });

  if (recipeNodes.length === 0) return null;

  // Use the first (or most complete) Recipe node
  const node = recipeNodes.reduce((best, cur) => {
    const score = (n: SchemaRecipe) =>
      (n.name ? 2 : 0) +
      (n.recipeIngredient?.length ? 3 : 0) +
      (n.recipeInstructions ? 3 : 0) +
      (n.image ? 1 : 0);
    return score(cur) > score(best) ? cur : best;
  });

  const title = String(node.name ?? '').trim();
  if (!title) return null;

  const ingredients: ParsedIngredient[] = (node.recipeIngredient ?? [])
    .map((s) => parseIngredientString(String(s)));

  const instructions = extractInstructions(node.recipeInstructions);

  const prepTime = node.prepTime ? parseDuration(node.prepTime) : 0;
  const cookTime = node.cookTime ? parseDuration(node.cookTime) : 0;
  // If only totalTime given, split evenly as rough estimate
  const totalTime = node.totalTime ? parseDuration(node.totalTime) : 0;
  const resolvedPrep = prepTime || (cookTime ? 0 : Math.floor(totalTime / 2));
  const resolvedCook = cookTime || Math.ceil(totalTime / 2);

  const recipe: ScrapedRecipe = {
    title,
    description: String(node.description ?? '').trim(),
    image_url: extractImage(node.image),
    ingredients,
    instructions,
    prep_time: resolvedPrep,
    cook_time: resolvedCook,
    servings: extractServings(node.recipeYield),
    dietary_tags: inferDietaryTags(node),
  };

  const hasIngredients = ingredients.length > 0;
  const hasInstructions = instructions.length > 0;

  const confidence: JsonLdExtractionResult['confidence'] =
    hasIngredients && hasInstructions ? 'high'
    : hasIngredients || hasInstructions ? 'medium'
    : 'low';

  return { recipe, confidence };
}
