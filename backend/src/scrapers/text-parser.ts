/**
 * Recipe text parser — converts raw unstructured text (e.g. an Instagram
 * caption, a copied blog post, or a WhatsApp message) into a structured
 * ScrapedRecipe object using pattern-matching heuristics.
 *
 * Handles German and English recipe formats.
 */

import { ScrapedRecipe, ParsedIngredient, parseIngredientString } from './generic';

// ─── Section-header patterns ──────────────────────────────────────────────────

/** Lines that signal the start of an ingredient list */
const INGREDIENT_HEADERS = /^(zutaten(\s+für\s+\d+\s*\w+)?|ingredients?(\s+for\s+\d+\s*\w+)?|du\s+brauchst|ihr\s+braucht|das\s+brauchst\s+du|einkaufsliste|für\s+den\s+teig|für\s+die\s+sauce|für\s+die\s+füllung|für\s+das\s+dressing)\s*:?\s*$/i;

/** Lines that signal the start of the instructions */
const INSTRUCTION_HEADERS = /^(zubereitung|anleitung|so\s+geht('?s)?|zubereiten|vorbereitung|preparation|instructions?|method|directions?|steps?|und\s+so\s+geht('?s)?|zubereitung\s+&\s+kochen)\s*:?\s*$/i;

/** Lines that are clearly noise: hashtags, follows, links, etc. */
// NOTE: Use word boundaries (\b) around short German stems to avoid matching
// common cooking words: "teile" → "verteilen", "like" → rare but safe with \b.
const NOISE_LINE = /^[#@]|^https?:\/\/|folg|follow|\blike\b|komment|link\s+in\s+bio|save\s+(this|das)|\bteile\b|share|tag\s+(jemand|someone)|mehr\s+rezepte|more\s+recipe/i;

// ─── Emoji removal ────────────────────────────────────────────────────────────

/** Remove emoji characters and trim. */
function stripEmojis(str: string): string {
  return str
    .replace(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1F9FF}]/gu, '')
    .replace(/[⭐✨🌟💫⚡🔥❤️💚💛🧡💜🖤🤍]/g, '')
    .trim();
}

// ─── Time extraction ──────────────────────────────────────────────────────────

/** Extract prep/cook time in minutes from a line like "Zubereitung: 30 Minuten" */
function extractTime(text: string): { prep_time: number; cook_time: number } {
  let prep_time = 0;
  let cook_time = 0;

  const patterns: Array<{ regex: RegExp; type: 'prep' | 'cook' | 'total' }> = [
    { regex: /zubereitungszeit[:\s]+(\d+)\s*(?:min(?:uten?)?|std\.?|stunden?)/gi, type: 'prep' },
    { regex: /prep(?:aration)?\s*time[:\s]+(\d+)\s*(?:min(?:utes?)?|h(?:ours?)?)/gi, type: 'prep' },
    { regex: /kochzeit[:\s]+(\d+)\s*(?:min(?:uten?)?|std\.?|stunden?)/gi, type: 'cook' },
    { regex: /cook(?:ing)?\s*time[:\s]+(\d+)\s*(?:min(?:utes?)?|h(?:ours?)?)/gi, type: 'cook' },
    { regex: /gesamtzeit[:\s]+(\d+)\s*(?:min(?:uten?)?|std\.?|stunden?)/gi, type: 'total' },
    { regex: /total\s+time[:\s]+(\d+)\s*(?:min(?:utes?)?|h(?:ours?)?)/gi, type: 'total' },
    { regex: /in\s+(?:nur\s+)?(\d+)\s*min(?:uten?)?/gi, type: 'total' },
  ];

  for (const { regex, type } of patterns) {
    const match = regex.exec(text);
    if (match) {
      const raw = parseInt(match[1], 10);
      // If unit is hours-like, convert to minutes
      const isHours = /std|stunden?|hour/i.test(match[0]);
      const minutes = isHours ? raw * 60 : raw;
      if (type === 'prep') prep_time = minutes;
      else if (type === 'cook') cook_time = minutes;
      else if (type === 'total') {
        // Split total evenly as a rough estimate
        prep_time = Math.round(minutes * 0.4);
        cook_time = Math.round(minutes * 0.6);
      }
    }
  }

  return { prep_time, cook_time };
}

// ─── Servings extraction ──────────────────────────────────────────────────────

function extractServings(text: string): number {
  const patterns = [
    /für\s+(\d+)\s*(?:personen|person|portionen?|people|servings?)/gi,
    /ergibt\s+(\d+)\s*(?:portionen?|servings?|stücke?)/gi,
    /(\d+)\s*portionen?/gi,
    /(\d+)\s*servings?/gi,
    /serves?\s+(\d+)/gi,
    /makes?\s+(\d+)/gi,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 50) return n;
    }
  }
  return 4; // default
}

// ─── Ingredient line detection ────────────────────────────────────────────────

/**
 * Returns true if a line looks like an ingredient:
 * starts with a bullet/dash/number, or starts with a quantity.
 */
function looksLikeIngredient(line: string): boolean {
  const cleaned = line.replace(/^[-•*·◦▪▸→✓✔]\s*/, '').trim();
  if (!cleaned) return false;

  // Must not be a long instruction-like sentence
  if (cleaned.length > 120) return false;

  // Starts with a number (quantity)
  if (/^\d/.test(cleaned)) return true;

  // Starts with a fraction character
  if (/^[½¼¾⅓⅔]/.test(cleaned)) return true;

  // Starts with a unit directly
  if (/^(eine?[rms]?|einige|etwas|nach\s+geschmack|salt\s+and|prise|eine\s+prise|handvoll)\b/i.test(cleaned)) return true;

  // "nach Geschmack" or "nach Bedarf" anywhere in a short line
  // → catches "Chiliflocken nach Geschmack", "Salz nach Bedarf", etc.
  if (/\bnach\s+(geschmack|bedarf)\b/i.test(cleaned)) return true;

  // Common German pantry staples / seasonings that appear without a quantity on short lines
  // → catches "Salz und Pfeffer", "Olivenöl", "Butter", etc.
  if (
    cleaned.length <= 50 &&
    /^(salz|pfeffer|olivenöl|sonnenblumenöl|rapsöl|öl|butter|mehl|zucker|honig|senf|essig|zitronensaft|zitrone|knoblauch|zwiebel|frühlingszwiebel|petersilie|basilikum|oregano|thymian|rosmarin|lorbeer|kümmel|muskat|muskatnuss|zimt|paprikapulver|chili|chiliflocken|cayennepfeffer|kurkuma|ingwer|kreuzkümmel|koriander|dill|schnittlauch|salbei|majoran|curry|garam\s+masala|sojasauce|worcester|tabasco|balsamico)\b/i.test(cleaned)
  ) return true;

  return false;
}

/**
 * Returns true if a line looks like an instruction step.
 */
function looksLikeInstruction(line: string): boolean {
  // Numbered step: "1." or "1)" or "Schritt 1:"
  if (/^\d+[.):]/.test(line)) return true;
  if (/^schritt\s+\d+/i.test(line)) return true;
  if (/^step\s+\d+/i.test(line)) return true;
  // Long line without a quantity at the start
  if (line.length > 40 && !/^\d/.test(line)) return true;
  return false;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export interface ParsedRecipeText {
  title: string;
  description: string;
  ingredients: ParsedIngredient[];
  instructions: string[];
  prep_time: number;
  cook_time: number;
  servings: number;
  dietary_tags: string[];
  confidence: 'high' | 'medium' | 'low';
}

type Section = 'preamble' | 'ingredients' | 'instructions' | 'notes';

export function parseRecipeText(raw: string): ParsedRecipeText {
  // ── 1. Pre-process ─────────────────────────────────────────────────────────
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Strip trailing hashtag blocks (Instagram noise at the end)
  let endIdx = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^#\w+/.test(lines[i]) || NOISE_LINE.test(lines[i])) {
      endIdx = i;
    } else {
      break;
    }
  }
  const cleanLines = lines.slice(0, endIdx);

  // Full text for time/servings extraction
  const fullText = raw;

  // ── 2. Find title ──────────────────────────────────────────────────────────
  let title = '';
  for (const line of cleanLines) {
    const candidate = stripEmojis(line).replace(/^[#*_]+|[#*_]+$/g, '').trim();
    if (
      candidate.length >= 3 &&
      candidate.length <= 100 &&
      !NOISE_LINE.test(line) &&
      !INGREDIENT_HEADERS.test(line) &&
      !INSTRUCTION_HEADERS.test(line)
    ) {
      title = candidate;
      break;
    }
  }

  // ── 3. Section detection ───────────────────────────────────────────────────
  const ingredientLines: string[] = [];
  const instructionLines: string[] = [];
  const descriptionLines: string[] = [];

  let section: Section = 'preamble';
  let foundExplicitIngredients = false;
  let foundExplicitInstructions = false;

  for (const line of cleanLines) {
    if (NOISE_LINE.test(line)) continue;

    const stripped = stripEmojis(line);

    // Section header detection
    if (INGREDIENT_HEADERS.test(stripped)) {
      section = 'ingredients';
      foundExplicitIngredients = true;
      continue;
    }
    if (INSTRUCTION_HEADERS.test(stripped)) {
      section = 'instructions';
      foundExplicitInstructions = true;
      continue;
    }
    // Sub-section headers within ingredients (e.g. "Für die Sauce:")
    if (/^für\s+(den|die|das)\s+\w+\s*:?\s*$/i.test(stripped) && section === 'ingredients') {
      // Keep as a separator — don't add to ingredients
      continue;
    }

    // Collect by section
    if (section === 'preamble') {
      if (stripped !== title && stripped.length > 10) {
        descriptionLines.push(stripped);
      }
    } else if (section === 'ingredients') {
      const clean = stripped.replace(/^[-•*·◦▪▸→✓✔]\s*/, '').trim();
      if (clean) ingredientLines.push(clean);
    } else if (section === 'instructions') {
      const clean = stripped.replace(/^\d+[.):\s]+/, '').trim();
      if (clean.length > 5) instructionLines.push(clean);
    }
  }

  // ── 4. Fallback: no explicit sections → heuristic classification ───────────
  if (!foundExplicitIngredients && !foundExplicitInstructions) {
    for (const line of cleanLines) {
      if (NOISE_LINE.test(line)) continue;
      const stripped = stripEmojis(line).replace(/^[-•*·◦▪▸→]\s*/, '').trim();
      if (!stripped || stripped === title) continue;

      if (looksLikeIngredient(line)) {
        ingredientLines.push(stripped);
      } else if (looksLikeInstruction(line)) {
        const clean = stripped.replace(/^\d+[.):\s]+/, '').trim();
        if (clean.length > 5) instructionLines.push(clean);
      } else if (descriptionLines.length < 3 && stripped.length > 15) {
        descriptionLines.push(stripped);
      }
    }
  }

  // ── 5. Parse ingredients ───────────────────────────────────────────────────
  const ingredients = ingredientLines
    .filter((l) => l.length >= 2)
    .map((l) => parseIngredientString(l));

  // ── 6. Detect dietary tags from title + ingredients ───────────────────────
  const fullLower = raw.toLowerCase();
  const dietary_tags: string[] = [];
  if (/\bvegan\b/.test(fullLower)) dietary_tags.push('Vegan');
  else if (/\bvegetarisch\b|\bvegetarian\b/.test(fullLower)) dietary_tags.push('Vegetarisch');
  if (/\bglutenfrei\b|\bgluten[- ]?free\b/.test(fullLower)) dietary_tags.push('Glutenfrei');
  if (/\blaktosefrei\b|\bdairy[- ]?free\b/.test(fullLower)) dietary_tags.push('Laktosefrei');
  if (/\blow[- ]?carb\b/.test(fullLower)) dietary_tags.push('Low Carb');
  if (/\bketo\b/.test(fullLower)) dietary_tags.push('Keto');
  if (/\bhochprotein\b|\bhigh[- ]?protein\b/.test(fullLower)) dietary_tags.push('Hochprotein');

  // ── 7. Extract time and servings ───────────────────────────────────────────
  const { prep_time, cook_time } = extractTime(fullText);
  const servings = extractServings(fullText);

  // ── 8. Description ─────────────────────────────────────────────────────────
  const description = descriptionLines.slice(0, 3).join(' ').substring(0, 500);

  // ── 9. Confidence scoring ──────────────────────────────────────────────────
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (
    title &&
    ingredients.length >= 3 &&
    instructionLines.length >= 2 &&
    foundExplicitIngredients &&
    foundExplicitInstructions
  ) {
    confidence = 'high';
  } else if (title && (ingredients.length >= 2 || instructionLines.length >= 2)) {
    confidence = 'medium';
  }

  return {
    title: title || 'Importiertes Rezept',
    description,
    ingredients,
    instructions: instructionLines,
    prep_time,
    cook_time,
    servings,
    dietary_tags,
    confidence,
  };
}

/**
 * Convert a ParsedRecipeText into a full ScrapedRecipe.
 */
export function toScrapedRecipe(parsed: ParsedRecipeText): ScrapedRecipe {
  return {
    title: parsed.title,
    description: parsed.description,
    image_url: '',
    ingredients: parsed.ingredients,
    instructions: parsed.instructions,
    prep_time: parsed.prep_time,
    cook_time: parsed.cook_time,
    servings: parsed.servings,
    dietary_tags: parsed.dietary_tags,
  };
}
