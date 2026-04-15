import { query, queryOne } from '../db';

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
  is_custom: boolean;
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

// pg returns JSONB as parsed objects and TIMESTAMPTZ as Date
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
  dietary_tags: string[];
  ingredients: Ingredient[];
  instructions: string[];
  rating: number | null;
  notes: string;
  is_custom: boolean;
  created_at: Date;
}

interface RawProfile {
  id: number;
  name: string;
  dietary_preferences: string[];
  dislikes: string[];
  allergies: string[];
  household_size: number;
  pantry_staples: string[];
  owned_ingredients: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseRecipe(raw: RawRecipe): Recipe {
  return {
    ...raw,
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : String(raw.created_at),
  };
}

function parseProfile(raw: RawProfile): UserProfile {
  return { ...raw };
}

function containsDisliked(recipe: Recipe, dislikes: string[]): boolean {
  if (dislikes.length === 0) return false;
  const ingredientText = recipe.ingredients.map(i => i.item.toLowerCase()).join(' ');
  return dislikes.some(d => ingredientText.includes(d.toLowerCase()));
}

function matchesDietaryPrefs(recipe: Recipe, prefs: string[]): boolean {
  if (prefs.length === 0) return true;
  return prefs.every(pref =>
    recipe.dietary_tags.some(tag => tag.toLowerCase() === pref.toLowerCase()),
  );
}

function scoreRecipe(
  recipe: Recipe,
  profile: UserProfile,
  recentlyEatenIds: Set<number>,
  veryRecentIds: Set<number>,
): number {
  let score = 0;

  if (recipe.rating != null) score += recipe.rating * 0.5;

  for (const pref of profile.dietary_preferences) {
    if (recipe.dietary_tags.some(t => t.toLowerCase() === pref.toLowerCase())) score += 1;
  }

  for (const dislike of profile.dislikes) {
    const ingredientText = recipe.ingredients.map(i => i.item.toLowerCase()).join(' ');
    if (ingredientText.includes(dislike.toLowerCase())) score -= 0.5;
  }

  if (veryRecentIds.has(recipe.id)) score -= 4;
  else if (recentlyEatenIds.has(recipe.id)) score -= 2;

  if (recipe.is_custom) score += 0.3;

  return score;
}

function weightedShuffle<T extends { _score: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => b._score - a._score);
  const result: T[] = [];

  while (sorted.length > 0) {
    const totalWeight = sorted.reduce((sum, _, i) => sum + 1 / (i + 1), 0);
    let random = Math.random() * totalWeight;
    let idx = 0;
    for (let i = 0; i < sorted.length; i++) {
      random -= 1 / (i + 1);
      if (random <= 0) { idx = i; break; }
    }
    result.push(sorted[idx]);
    sorted.splice(idx, 1);
  }

  return result;
}

// ─── Main exports ────────────────────────────────────────────────────────────

export async function getUserProfile(profileId = 1): Promise<UserProfile> {
  const raw = await queryOne<RawProfile>('SELECT * FROM user_profile WHERE id = $1', [profileId]);
  if (!raw) throw new Error(`Profile ${profileId} not found`);
  return parseProfile(raw);
}

export async function getUserProfileByClerkId(clerkUserId: string): Promise<UserProfile | null> {
  const raw = await queryOne<RawProfile>(
    'SELECT * FROM user_profile WHERE clerk_user_id = $1',
    [clerkUserId],
  );
  if (!raw) return null;
  return parseProfile(raw);
}

export async function getSuggestions(profileId: number, count: number): Promise<Recipe[]> {
  const profile = await getUserProfile(profileId);
  const rawRecipes = await query<RawRecipe>('SELECT * FROM recipes');
  const recipes = rawRecipes.map(parseRecipe);

  const now = Date.now();
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const recentHistory = await query<{ recipe_id: number }>(
    'SELECT DISTINCT recipe_id FROM meal_history WHERE eaten_at >= $1', [fourteenDaysAgo],
  );
  const veryRecentHistory = await query<{ recipe_id: number }>(
    'SELECT DISTINCT recipe_id FROM meal_history WHERE eaten_at >= $1', [sevenDaysAgo],
  );

  const recentlyEatenIds = new Set(recentHistory.map(r => r.recipe_id));
  const veryRecentIds = new Set(veryRecentHistory.map(r => r.recipe_id));

  const filtered = recipes.filter(r => {
    if (!matchesDietaryPrefs(r, profile.dietary_preferences)) return false;
    if (containsDisliked(r, profile.allergies)) return false;
    return true;
  });

  const scored = filtered.map(r => ({
    ...r,
    _score: scoreRecipe(r, profile, recentlyEatenIds, veryRecentIds),
  }));

  return weightedShuffle(scored).slice(0, count).map(({ _score: _s, ...recipe }) => recipe as Recipe);
}

export async function generateWeekPlan(clerkUserId: string): Promise<Omit<MealSlot, 'id'>[]> {
  const profile = await getUserProfileByClerkId(clerkUserId);
  if (!profile) throw new Error('Profile not found');
  const allRecipes = (await query<RawRecipe>('SELECT * FROM recipes')).map(parseRecipe);

  const filtered = allRecipes.filter(r => {
    if (!matchesDietaryPrefs(r, profile.dietary_preferences)) return false;
    if (containsDisliked(r, profile.allergies)) return false;
    return true;
  });

  const quickRecipes = filtered.filter(r => (r.prep_time + r.cook_time) <= 20);
  const heartierRecipes = filtered.filter(r => (r.prep_time + r.cook_time) > 15);
  const breakfastPool = quickRecipes.length >= 3 ? quickRecipes : filtered;
  const snackPool = quickRecipes.length >= 3 ? quickRecipes : filtered;
  const lunchPool = heartierRecipes.length >= 3 ? heartierRecipes : filtered;
  const dinnerPool = filtered;

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

  const getRecipe = (pool: Recipe[], index: number): Recipe => pool[index % pool.length];

  const slots: Omit<MealSlot, 'id' | 'plan_id'>[] = [];
  let lunchIdx = 0, dinnerIdx = 0, breakfastIdx = 0, snackIdx = 0;

  for (let day = 0; day < 7; day++) {
    slots.push({ day, meal_type: 'breakfast', recipe_id: getRecipe(shuffledBreakfast, breakfastIdx++).id });
    slots.push({ day, meal_type: 'lunch',     recipe_id: getRecipe(shuffledLunch, lunchIdx++).id });
    slots.push({ day, meal_type: 'dinner',    recipe_id: getRecipe(shuffledDinner, dinnerIdx++).id });
    slots.push({ day, meal_type: 'snack',     recipe_id: getRecipe(shuffledSnack, snackIdx++).id });
  }

  return slots.map(s => ({ ...s, plan_id: 0 }));
}

export async function recordMealEaten(recipeId: number): Promise<void> {
  await query('INSERT INTO meal_history (recipe_id) VALUES ($1)', [recipeId]);
}
