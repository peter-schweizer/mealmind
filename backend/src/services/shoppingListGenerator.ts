import { query } from '../db';
import { Ingredient } from './suggestionEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShoppingItem {
  ingredient: string;
  amount: number | '';
  unit: string;
  recipes: string[];
  category: string;
  owned: boolean;
}

interface RawMealSlot {
  id: number;
  plan_id: number;
  day: number;
  meal_type: string;
  recipe_id: number;
}

interface RawRecipe {
  id: number;
  title: string;
  servings: number;
  ingredients: Ingredient[]; // JSONB — already parsed by pg
}

// ─── Category keyword mapping ─────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Array<{ category: string; keywords: string[] }> = [
  {
    category: 'Gemüse & Obst',
    keywords: [
      'tomate', 'gurke', 'paprika', 'zwiebel', 'knoblauch', 'karotte', 'möhre',
      'zucchini', 'brokkoli', 'blumenkohl', 'spinat', 'salat', 'kohl', 'sellerie',
      'lauch', 'champignon', 'pilz', 'aubergine', 'kartoffel', 'süßkartoffel',
      'erbse', 'bohne', 'linse', 'kichererbse', 'avocado', 'zitrone', 'limette',
      'orange', 'apfel', 'banane', 'ingwer', 'chili', 'frühlingszwiebel',
      'radieschen', 'kürbis', 'mais',
    ],
  },
  {
    category: 'Fleisch & Fisch',
    keywords: [
      'hähnchen', 'hühnchen', 'pute', 'rind', 'hack', 'schwein', 'speck', 'bacon',
      'schinken', 'wurst', 'bratwurst', 'chorizo', 'pancetta', 'lachs', 'thunfisch',
      'garnele', 'shrimp', 'forelle', 'kabeljau', 'fisch', 'lamm', 'mett', 'räucherwurst',
    ],
  },
  {
    category: 'Milchprodukte & Eier',
    keywords: [
      'milch', 'sahne', 'butter', 'käse', 'joghurt', 'quark', 'frischkäse',
      'mozzarella', 'parmesan', 'pecorino', 'feta', 'cheddar', 'ei', 'eier',
      'schmand', 'kokosmilch',
    ],
  },
  {
    category: 'Backwaren & Getreide',
    keywords: [
      'mehl', 'brot', 'brötchen', 'nudel', 'spaghetti', 'pasta', 'reis', 'couscous',
      'quinoa', 'haferflocken', 'hefe', 'backpulver', 'tortilla', 'lasagne',
    ],
  },
  {
    category: 'Gewürze & Öle',
    keywords: [
      'salz', 'pfeffer', 'kurkuma', 'kreuzkümmel', 'koriander', 'zimt', 'muskat',
      'oregano', 'thymian', 'rosmarin', 'basilikum', 'petersilie', 'schnittlauch',
      'curry', 'öl', 'olivenöl', 'kokosöl', 'essig', 'sojasoße', 'senf', 'tomatenmark',
    ],
  },
  {
    category: 'Konserven & Trockenwaren',
    keywords: [
      'dose', 'konserve', 'linse', 'kichererbse', 'bohne', 'oliven', 'kapern',
    ],
  },
  { category: 'Sonstiges', keywords: [] },
];

// ─── Unit conversion ─────────────────────────────────────────────────────────

interface UnitGroup {
  baseUnit: string;
  conversions: Record<string, number>;
}

const UNIT_GROUPS: UnitGroup[] = [
  { baseUnit: 'g',  conversions: { g: 1, kg: 1000, mg: 0.001 } },
  { baseUnit: 'ml', conversions: { ml: 1, l: 1000, cl: 10, dl: 100 } },
  { baseUnit: 'EL', conversions: { EL: 1 } },
  { baseUnit: 'TL', conversions: { TL: 1 } },
];

function toBaseUnit(amount: number, unit: string): { amount: number; unit: string } {
  for (const group of UNIT_GROUPS) {
    const conv = Object.entries(group.conversions).find(([k]) => k.toLowerCase() === unit.toLowerCase());
    if (conv) return { amount: amount * conv[1], unit: group.baseUnit };
  }
  return { amount, unit };
}

function fromBaseUnit(amount: number, baseUnit: string): { amount: number; unit: string } {
  if (baseUnit === 'g' && amount >= 1000) return { amount: Math.round((amount / 1000) * 100) / 100, unit: 'kg' };
  if (baseUnit === 'ml' && amount >= 1000) return { amount: Math.round((amount / 1000) * 100) / 100, unit: 'l' };
  return { amount: Math.round(amount * 100) / 100, unit: baseUnit };
}

function detectCategory(name: string): string {
  const lower = name.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.length === 0) continue;
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return 'Sonstiges';
}

function isPantryStaple(name: string, pantryStaples: string[]): boolean {
  const lower = name.toLowerCase();
  return pantryStaples.some(s => lower.includes(s.toLowerCase()));
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function generateShoppingList(
  planId: number,
  householdSize: number,
  hidePantryStaples: boolean,
  pantryStaples: string[],
  ownedIngredients: string[] = [],
): Promise<ShoppingItem[]> {
  const slots = await query<RawMealSlot>(
    'SELECT * FROM meal_slots WHERE plan_id = $1', [planId],
  );
  if (slots.length === 0) return [];

  const recipeIds = [...new Set(slots.map(s => s.recipe_id))];
  const rawRecipes = await query<RawRecipe>(
    'SELECT id, title, servings, ingredients FROM recipes WHERE id = ANY($1)',
    [recipeIds],
  );

  const recipeMap = new Map<number, { title: string; servings: number; ingredients: Ingredient[] }>();
  for (const r of rawRecipes) {
    recipeMap.set(r.id, {
      title: r.title,
      servings: r.servings || 4,
      ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    });
  }

  const recipeSlotCount = new Map<number, number>();
  for (const slot of slots) {
    recipeSlotCount.set(slot.recipe_id, (recipeSlotCount.get(slot.recipe_id) || 0) + 1);
  }

  interface MergeEntry {
    ingredient: string;
    totalBaseAmount: number;
    baseUnit: string;
    unitless: boolean;
    count: number;
    recipes: Set<string>;
  }

  const merged = new Map<string, MergeEntry>();

  for (const [recipeId, slotCount] of recipeSlotCount) {
    const recipe = recipeMap.get(recipeId);
    if (!recipe) continue;

    const scaleFactor = (householdSize / recipe.servings) * slotCount;

    for (const ing of recipe.ingredients) {
      if (!ing.item) continue;
      const normalized = ing.item.toLowerCase().trim();

      if (ing.amount === '' || ing.amount === 0) {
        const key = `${normalized}::`;
        const existing = merged.get(key);
        if (existing) {
          existing.recipes.add(recipe.title);
        } else {
          merged.set(key, { ingredient: ing.item, totalBaseAmount: 0, baseUnit: '', unitless: true, count: 0, recipes: new Set([recipe.title]) });
        }
        continue;
      }

      const scaledAmount = Number(ing.amount) * scaleFactor;
      const unit = ing.unit || '';

      if (!unit) {
        const key = `${normalized}::count`;
        const existing = merged.get(key);
        if (existing) {
          existing.count += scaledAmount;
          existing.totalBaseAmount += scaledAmount;
          existing.recipes.add(recipe.title);
        } else {
          merged.set(key, { ingredient: ing.item, totalBaseAmount: scaledAmount, baseUnit: '', unitless: false, count: scaledAmount, recipes: new Set([recipe.title]) });
        }
        continue;
      }

      const { amount: baseAmount, unit: baseUnit } = toBaseUnit(scaledAmount, unit);
      const key = `${normalized}::${baseUnit}`;
      const existing = merged.get(key);
      if (existing) {
        existing.totalBaseAmount += baseAmount;
        existing.recipes.add(recipe.title);
      } else {
        merged.set(key, { ingredient: ing.item, totalBaseAmount: baseAmount, baseUnit, unitless: false, count: 0, recipes: new Set([recipe.title]) });
      }
    }
  }

  const result: ShoppingItem[] = [];

  for (const entry of merged.values()) {
    const isOwned = ownedIngredients.some(o => entry.ingredient.toLowerCase().includes(o.toLowerCase()));
    const isStaple = isPantryStaple(entry.ingredient, pantryStaples);
    if (hidePantryStaples && isStaple) continue;

    let finalAmount: number | '' = '';
    let finalUnit = '';

    if (entry.unitless) {
      finalAmount = ''; finalUnit = '';
    } else if (entry.count > 0 && !entry.baseUnit) {
      finalAmount = Math.ceil(entry.count); finalUnit = '';
    } else if (entry.baseUnit) {
      const { amount, unit } = fromBaseUnit(entry.totalBaseAmount, entry.baseUnit);
      finalAmount = amount; finalUnit = unit;
    }

    result.push({
      ingredient: entry.ingredient,
      amount: finalAmount,
      unit: finalUnit,
      recipes: [...entry.recipes],
      category: detectCategory(entry.ingredient),
      owned: isOwned || isStaple,
    });
  }

  const categoryOrder = CATEGORY_KEYWORDS.map(c => c.category);
  result.sort((a, b) => {
    const diff = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    return diff !== 0 ? diff : a.ingredient.localeCompare(b.ingredient, 'de');
  });

  return result;
}
