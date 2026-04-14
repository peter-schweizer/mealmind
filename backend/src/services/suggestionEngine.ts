import db from '../db';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Ingredient {
  amount: number | '';
  unit: string;
  item: string;
}

export interface Recipe {
  id: number;
  title: string;
  description: string;
  image_url: string;
  source_url: string;
  source_name: string;
  prep_time: number;
  cook_time: number;
  servings: number;
  dietary_tags: string[];
  ingredients: Ingredient[];
  instructions: string[];
  rating: number | null;
  notes: string;
  is_custom: number;
  created_at: string;
}

export interface UserProfile {
  id: number;
  name: string;
  dietary_preferences: string[];
  dislikes: string[];
  allergies: string[];
  household_size: number;
  pantry_staples: string[];
  owned_ingredients: string[];
}

export interface MealSlot {
  id?: number;
  plan_id: number;
  day: number;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  recipe_id: number;
}

interface RawRecipe {
  id: number;
  title: string;
  description: string;
  image_url: string;
  source_url: string;
  source_name: string;
  prep_time: number;
  cook_time: number;
  servings: number;
  dietary_tags: string;
  ingredients: string;
  instructions: string;
  rating: number | null;
  notes: string;
  is_custom: number;
  created_at: string;
}

interface RawProfile {
  id: number;
  name: string;
  dietary_preferences: string;
  dislikes: string;
  allergies: string;
  household_size: number;
  pantry_staples: string;
  owned_ingredients: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseRecipe(raw: RawRecipe): Recipe {
  return {
    ...raw,
    dietary_tags: safeParseJson<string[]>(raw.dietary_tags, []),
    ingredients: safeParseJson<Ingredient[]>(raw.ingredients, []),
    instructions: safeParseJson<string[]>(raw.instructions, []),
  };
}

function parseProfile(raw: RawProfile): UserProfile {
  return {
    ...raw,
    dietary_preferences: safeParseJson<string[]>(raw.dietary_preferences, []),
    dislikes: safeParseJson<string[]>(raw.dislikes, []),
    allergies: safeParseJson<string[]>(raw.allergies, []),
    pantry_staples: safeParseJson<string[]>(raw.pantry_staples, []),
    owned_ingredients: safeParseJson<string[]>(raw.owned_ingredients, []),
  };
}

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Check whether a recipe ingredient list contains any of the disliked items.
 */
function containsDisliked(recipe: Recipe, dislikes: string[]): boolean {
  if (dislikes.length === 0) return false;
  const ingredientText = recipe.ingredients
    .map(i => i.item.toLowerCase())
    .join(' ');
  return dislikes.some(d => ingredientText.includes(d.toLowerCase()));
}

/**
 * Check whether a recipe matches all of the user's required dietary preferences.
 */
function matchesDietaryPrefs(recipe: Recipe, prefs: string[]): boolean {
  if (prefs.length === 0) return true;
  return prefs.every(pref =>
    recipe.dietary_tags.some(tag => tag.toLowerCase() === pref.toLowerCase()),
  );
}

/**
 * Score a recipe based on profile preferences and recent history.
 * Higher score = better match.
 */
function scoreRecipe(
  recipe: Recipe,
  profile: UserProfile,
  recentlyEatenIds: Set<number>,
  veryRecentIds: Set<number>,
): number {
  let score = 0;

  // Base score from rating
  if (recipe.rating != null) {
    score += recipe.rating * 0.5;
  }

  // Boost for matching dietary tags
  for (const pref of profile.dietary_preferences) {
    if (recipe.dietary_tags.some(t => t.toLowerCase() === pref.toLowerCase())) {
      score += 1;
    }
  }

  // Penalty for disliked ingredients
  for (const dislike of profile.dislikes) {
    const ingredientText = recipe.ingredients.map(i => i.item.toLowerCase()).join(' ');
    if (ingredientText.includes(dislike.toLowerCase())) {
      score -= 0.5;
    }
  }

  // Penalty for recently eaten (avoid repetition)
  if (veryRecentIds.has(recipe.id)) {
    score -= 4; // eaten in last 7 days — strong penalty
  } else if (recentlyEatenIds.has(recipe.id)) {
    score -= 2; // eaten in last 14 days — moderate penalty
  }

  // Slight boost for custom recipes (user created them intentionally)
  if (recipe.is_custom) {
    score += 0.3;
  }

  return score;
}

/**
 * Shuffle an array using Fisher-Yates with score weighting.
 * Higher-scored items are more likely to appear near the front.
 */
function weightedShuffle<T extends { _score: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => b._score - a._score);
  const result: T[] = [];

  while (sorted.length > 0) {
    // Weighted random selection biased toward front (higher scores)
    const totalWeight = sorted.reduce((sum, _, i) => sum + 1 / (i + 1), 0);
    let random = Math.random() * totalWeight;
    let idx = 0;
    for (let i = 0; i < sorted.length; i++) {
      random -= 1 / (i + 1);
      if (random <= 0) {
        idx = i;
        break;
      }
    }
    result.push(sorted[idx]);
    sorted.splice(idx, 1);
  }

  return result;
}

// ─── Main exports ────────────────────────────────────────────────────────────

/**
 * Get the user profile from DB.
 */
export function getUserProfile(profileId = 1): UserProfile {
  const raw = db.prepare('SELECT * FROM user_profile WHERE id = ?').get(profileId) as RawProfile | undefined;
  if (!raw) throw new Error(`Profile ${profileId} not found`);
  return parseProfile(raw);
}

/**
 * Get smart recipe suggestions for the user.
 */
export function getSuggestions(profileId: number, count: number): Recipe[] {
  const profile = getUserProfile(profileId);

  const rawRecipes = db.prepare('SELECT * FROM recipes').all() as unknown as RawRecipe[];
  const recipes = rawRecipes.map(parseRecipe);

  // Get recent meal history
  const now = Date.now();
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const recentHistory = db.prepare(
    'SELECT DISTINCT recipe_id FROM meal_history WHERE eaten_at >= ?',
  ).all(fourteenDaysAgo) as { recipe_id: number }[];
  const veryRecentHistory = db.prepare(
    'SELECT DISTINCT recipe_id FROM meal_history WHERE eaten_at >= ?',
  ).all(sevenDaysAgo) as { recipe_id: number }[];

  const recentlyEatenIds = new Set(recentHistory.map(r => r.recipe_id));
  const veryRecentIds = new Set(veryRecentHistory.map(r => r.recipe_id));

  // Filter by dietary preferences and dislikes
  const filtered = recipes.filter(r => {
    if (!matchesDietaryPrefs(r, profile.dietary_preferences)) return false;
    if (containsDisliked(r, profile.allergies)) return false; // hard filter for allergies
    return true;
  });

  // Score and shuffle
  const scored = filtered.map(r => ({
    ...r,
    _score: scoreRecipe(r, profile, recentlyEatenIds, veryRecentIds),
  }));

  const shuffled = weightedShuffle(scored);

  return shuffled.slice(0, count).map(({ _score: _s, ...recipe }) => recipe as Recipe);
}

/**
 * Generate a full week meal plan (7 days × 4 meal types).
 * Breakfast and snack can repeat; lunch and dinner should vary as much as possible.
 */
export function generateWeekPlan(profileId: number): Omit<MealSlot, 'id'>[] {
  const profile = getUserProfile(profileId);

  // Get pool of recipes for different meal types
  // For breakfast/snack: quick recipes (prep+cook <= 20 min) or any
  // For lunch/dinner: heartier recipes
  const allRecipes = (db.prepare('SELECT * FROM recipes').all() as unknown as RawRecipe[]).map(parseRecipe);

  const filtered = allRecipes.filter(r => {
    if (!matchesDietaryPrefs(r, profile.dietary_preferences)) return false;
    if (containsDisliked(r, profile.allergies)) return false;
    return true;
  });

  // Separate into pools
  const quickRecipes = filtered.filter(r => (r.prep_time + r.cook_time) <= 20);
  const heartierRecipes = filtered.filter(r => (r.prep_time + r.cook_time) > 15);
  const breakfastPool = quickRecipes.length >= 3 ? quickRecipes : filtered;
  const snackPool = quickRecipes.length >= 3 ? quickRecipes : filtered;
  const lunchPool = heartierRecipes.length >= 3 ? heartierRecipes : filtered;
  const dinnerPool = filtered;

  // Shuffle each pool
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const shuffledBreakfast = shuffle(breakfastPool);
  const shuffledSnack = shuffle(snackPool);
  const shuffledLunch = shuffle(lunchPool);
  const shuffledDinner = shuffle(dinnerPool);

  const getRecipe = (pool: Recipe[], index: number): Recipe => {
    return pool[index % pool.length];
  };

  const slots: Omit<MealSlot, 'id' | 'plan_id'>[] = [];
  const DAYS = 7;

  // Breakfast and snack can repeat (2 varieties across 7 days is fine)
  // Lunch and dinner should vary as much as possible
  let lunchIdx = 0;
  let dinnerIdx = 0;
  let breakfastIdx = 0;
  let snackIdx = 0;

  for (let day = 0; day < DAYS; day++) {
    slots.push({ day, meal_type: 'breakfast', recipe_id: getRecipe(shuffledBreakfast, breakfastIdx++).id });
    slots.push({ day, meal_type: 'lunch', recipe_id: getRecipe(shuffledLunch, lunchIdx++).id });
    slots.push({ day, meal_type: 'dinner', recipe_id: getRecipe(shuffledDinner, dinnerIdx++).id });
    slots.push({ day, meal_type: 'snack', recipe_id: getRecipe(shuffledSnack, snackIdx++).id });
  }

  return slots.map(s => ({ ...s, plan_id: 0 })); // plan_id will be set by caller
}

/**
 * Record a meal as eaten in history.
 */
export function recordMealEaten(recipeId: number): void {
  db.prepare('INSERT INTO meal_history (recipe_id) VALUES (?)').run(recipeId);
}
