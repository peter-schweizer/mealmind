export interface Recipe {
  id: number;
  title: string;
  description?: string;
  image_url?: string;
  source_url?: string;
  source_name?: string;
  prep_time?: number;
  cook_time?: number;
  servings?: number;
  dietary_tags: string[];
  ingredients: Ingredient[];
  instructions: string[];
  rating?: number;
  notes?: string;
  is_custom: boolean;
  created_at: string;
  match_score?: number;
}

export interface Ingredient {
  amount?: number;
  unit?: string;
  item: string;
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

export interface AuthField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'email';
  placeholder?: string;
  hint?: string;
}

export interface AuthConfig {
  label: string;
  description: string;
  privacyNote?: string;
  fields: AuthField[];
}

export interface SourceDefinition {
  scraper_type: string;
  name: string;
  defaultUrl: string;
  description: string;
  icon: string;
  supportsAuth: boolean;
  authConfig: AuthConfig | null;
}

export interface RecipeSource {
  id: number;
  name: string;
  url: string;
  scraper_type: string;
  status: 'active' | 'error' | 'pending' | 'syncing';
  last_sync?: string;
  error_message?: string;
  // Auth fields
  auth_type: string;
  auth_status: 'unauthenticated' | 'authenticated' | 'error';
  auth_error?: string;
  auth_username?: string;
  is_authenticated: boolean;
  auth_config: AuthConfig | null;
}

export interface WeekPlan {
  id: number;
  name: string;
  week_start: string;
  created_at: string;
  slots?: MealSlot[];
}

export interface MealSlot {
  id: number;
  plan_id: number;
  day: number;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  recipe_id: number;
  recipe?: Recipe;
}

export interface ShoppingItem {
  ingredient: string;
  amount?: number;
  unit?: string;
  recipes: string[];
  category: string;
  owned: boolean;
}

export const DIETARY_TAGS = [
  'Vegan',
  'Vegetarisch',
  'Pescetarisch',
  'Low Carb',
  'Keto',
  'Diabetiker-geeignet',
  'Glutenfrei',
  'Laktosefrei',
  'Hochprotein',
] as const;

export const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Frühstück',
  lunch: 'Mittagessen',
  dinner: 'Abendessen',
  snack: 'Snack',
};

export type DietaryTag = (typeof DIETARY_TAGS)[number];
export type Day = (typeof DAYS)[number];
export type MealType = (typeof MEAL_TYPES)[number];
