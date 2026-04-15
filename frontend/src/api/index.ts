import axios from 'axios';
import type {
  Recipe,
  UserProfile,
  RecipeSource,
  SourceDefinition,
  WeekPlan,
  MealSlot,
  ShoppingItem,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// ─── Recipes ────────────────────────────────────────────────────────────────

export interface RecipeParams {
  search?: string;
  tags?: string[];
  source?: string;
  is_custom?: boolean;
  limit?: number;
  offset?: number;
}

export async function getRecipes(params?: RecipeParams): Promise<Recipe[]> {
  const { data } = await api.get<Recipe[]>('/recipes', { params });
  return data;
}

export async function getRecipe(id: number): Promise<Recipe> {
  const { data } = await api.get<Recipe>(`/recipes/${id}`);
  return data;
}

export async function createRecipe(
  recipeData: Omit<Recipe, 'id' | 'created_at'>
): Promise<Recipe> {
  const { data } = await api.post<Recipe>('/recipes', recipeData);
  return data;
}

export async function updateRecipe(
  id: number,
  recipeData: Partial<Omit<Recipe, 'id' | 'created_at'>>
): Promise<Recipe> {
  const { data } = await api.put<Recipe>(`/recipes/${id}`, recipeData);
  return data;
}

export async function deleteRecipe(id: number): Promise<void> {
  await api.delete(`/recipes/${id}`);
}

export async function rateRecipe(
  id: number,
  rating: number,
  notes?: string
): Promise<Recipe> {
  const { data } = await api.post<Recipe>(`/recipes/${id}/rate`, {
    rating,
    notes,
  });
  return data;
}

export async function getSuggestions(): Promise<Recipe[]> {
  const { data } = await api.get<Recipe[]>('/recipes/suggestions');
  return data;
}

export async function scrapeRecipe(
  url: string,
  source_name?: string
): Promise<Recipe> {
  const { data } = await api.post<Recipe>('/recipes/scrape', {
    url,
    source_name,
  });
  return data;
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getProfile(): Promise<UserProfile> {
  const { data } = await api.get<UserProfile>('/profile');
  return data;
}

export async function updateProfile(
  profileData: Partial<Omit<UserProfile, 'id'>>
): Promise<UserProfile> {
  const { data } = await api.put<UserProfile>('/profile', profileData);
  return data;
}

export async function updatePantry(staples: string[]): Promise<UserProfile> {
  const { data } = await api.put<UserProfile>('/profile/pantry', { staples });
  return data;
}

export async function toggleOwned(ingredient: string): Promise<UserProfile> {
  const { data } = await api.post<UserProfile>('/profile/owned', {
    ingredient,
  });
  return data;
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export async function getPlans(): Promise<WeekPlan[]> {
  const { data } = await api.get<WeekPlan[]>('/plans');
  return data;
}

export async function createPlan(
  name: string,
  week_start: string
): Promise<WeekPlan> {
  const { data } = await api.post<WeekPlan>('/plans', { name, week_start });
  return data;
}

export async function getPlan(id: number): Promise<WeekPlan> {
  const { data } = await api.get<WeekPlan>(`/plans/${id}`);
  return data;
}

export async function updatePlan(id: number, name: string): Promise<WeekPlan> {
  const { data } = await api.put<WeekPlan>(`/plans/${id}`, { name });
  return data;
}

export async function deletePlan(id: number): Promise<void> {
  await api.delete(`/plans/${id}`);
}

export async function generateWeek(planId: number): Promise<WeekPlan> {
  const { data } = await api.post<WeekPlan>(`/plans/${planId}/generate`);
  return data;
}

export async function addSlot(
  planId: number,
  day: number,
  meal_type: string,
  recipe_id: number
): Promise<MealSlot> {
  const { data } = await api.post<MealSlot>(`/plans/${planId}/slots`, {
    day,
    meal_type,
    recipe_id,
  });
  return data;
}

export async function deleteSlot(
  planId: number,
  slotId: number
): Promise<void> {
  await api.delete(`/plans/${planId}/slots/${slotId}`);
}

export async function getShoppingList(
  planId: number
): Promise<ShoppingItem[]> {
  const { data } = await api.get<ShoppingItem[]>(
    `/plans/${planId}/shopping`
  );
  return data;
}

export async function getIcal(planId: number): Promise<string> {
  const { data } = await api.get<string>(`/plans/${planId}/ical`, {
    responseType: 'text',
  });
  return data;
}

// ─── Meta-search ─────────────────────────────────────────────────────────────

export interface ExternalSearchResult {
  title: string;
  url: string;
  image_url?: string;
  description?: string;
  source_name: string;
  scraper_type: string;
  prep_time?: number;
  rating?: number;
}

export async function searchExternalRecipes(
  query: string,
  sources?: string[],
  limit?: number
): Promise<ExternalSearchResult[]> {
  const params: Record<string, string | number> = { q: query };
  if (sources?.length) params['sources'] = sources.join(',');
  if (limit) params['limit'] = limit;
  const { data } = await api.get<ExternalSearchResult[]>('/search', { params });
  return data;
}

// ─── Sources ─────────────────────────────────────────────────────────────────

export async function getSources(): Promise<RecipeSource[]> {
  const { data } = await api.get<RecipeSource[]>('/sources');
  return data;
}

export async function getSourceRegistry(): Promise<SourceDefinition[]> {
  const { data } = await api.get<SourceDefinition[]>('/sources/registry');
  return data;
}

export async function addSource(
  name: string,
  url: string
): Promise<RecipeSource> {
  const { data } = await api.post<RecipeSource>('/sources', { name, url });
  return data;
}

export async function deleteSource(id: number): Promise<void> {
  await api.delete(`/sources/${id}`);
}

export async function syncSource(id: number): Promise<{ source: RecipeSource; scraped: number; discovered: number }> {
  const { data } = await api.post(`/sources/${id}/sync`);
  return data;
}

export async function loginSource(
  id: number,
  credentials: Record<string, string>
): Promise<RecipeSource> {
  const { data } = await api.post<RecipeSource>(`/sources/${id}/login`, credentials);
  return data;
}

export async function logoutSource(id: number): Promise<RecipeSource> {
  const { data } = await api.post<RecipeSource>(`/sources/${id}/logout`);
  return data;
}

export async function validateSourceSession(id: number): Promise<{ valid: boolean }> {
  const { data } = await api.post<{ valid: boolean }>(`/sources/${id}/validate-session`);
  return data;
}

export default api;
