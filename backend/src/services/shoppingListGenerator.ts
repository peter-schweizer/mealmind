import db from '../db';
import { Ingredient, Recipe } from './suggestionEngine';

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
  ingredients: string;
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
      'hähnchen', 'hühnchen', 'pute', 'truthahn', 'rind', 'rinderhack', 'hack',
      'schwein', 'speck', 'bacon', 'schinken', 'wurst', 'bratwurst', 'chorizo',
      'pancetta', 'lachs', 'thunfisch', 'garnele', 'shrimp', 'forelle', 'kabeljau',
      'fisch', 'lamm', 'kalb', 'ente', 'mett', 'räucherwurst', 'mettenden',
    ],
  },
  {
    category: 'Milchprodukte & Eier',
    keywords: [
      'milch', 'sahne', 'butter', 'käse', 'joghurt', 'quark', 'frischkäse',
      'mozzarella', 'parmesan', 'pecorino', 'feta', 'cheddar', 'ei', 'eier',
      'schmand', 'crème fraîche', 'buttermilch', 'kokosmilch',
    ],
  },
  {
    category: 'Backwaren & Getreide',
    keywords: [
      'mehl', 'brot', 'brötchen', 'nudel', 'spaghetti', 'pasta', 'reis', 'couscous',
      'quinoa', 'haferflocken', 'paniermehl', 'hefe', 'backpulver', 'semmel',
      'tortilla', 'lasagne', 'penne', 'fusilli', 'tagliatelle', 'gnocchi',
    ],
  },
  {
    category: 'Gewürze & Öle',
    keywords: [
      'salz', 'pfeffer', 'paprika', 'kurkuma', 'kreuzkümmel', 'koriander',
      'zimt', 'muskat', 'oregano', 'thymian', 'rosmarin', 'basilikum',
      'petersilie', 'schnittlauch', 'lorbeer', 'curry', 'öl', 'olivenöl',
      'kokosöl', 'essig', 'sojasoße', 'senf', 'tomatenmark', 'tomatenpassata',
      'prise', 'cayenne', 'chilitflocken', 'vanille',
    ],
  },
  {
    category: 'Konserven & Trockenwaren',
    keywords: [
      'dose', 'konserve', 'linse', 'kichererbse', 'bohne', 'erbse', 'mais',
      'tomate', 'passata', 'cocos', 'oliven', 'kapern', 'sardine', 'thunfisch',
    ],
  },
  {
    category: 'Sonstiges',
    keywords: [],
  },
];

// ─── Unit conversion helpers ─────────────────────────────────────────────────

interface UnitGroup {
  baseUnit: string;
  conversions: Record<string, number>; // unit -> multiplier to baseUnit
}

const UNIT_GROUPS: UnitGroup[] = [
  {
    baseUnit: 'g',
    conversions: { g: 1, kg: 1000, mg: 0.001 },
  },
  {
    baseUnit: 'ml',
    conversions: { ml: 1, l: 1000, cl: 10, dl: 100 },
  },
  {
    baseUnit: 'EL',
    conversions: { EL: 1 },
  },
  {
    baseUnit: 'TL',
    conversions: { TL: 1 },
  },
];

function findUnitGroup(unit: string): UnitGroup | null {
  for (const group of UNIT_GROUPS) {
    if (unit.toLowerCase() in Object.fromEntries(
      Object.keys(group.conversions).map(k => [k.toLowerCase(), true]),
    )) {
      return group;
    }
  }
  return null;
}

/**
 * Convert an amount+unit to the base unit of its group.
 * Returns { amount, unit } in base units, or original if no conversion found.
 */
function toBaseUnit(amount: number, unit: string): { amount: number; unit: string } {
  const group = findUnitGroup(unit);
  if (!group) return { amount, unit };

  const unitLower = unit.toLowerCase();
  const conversion = Object.entries(group.conversions).find(
    ([k]) => k.toLowerCase() === unitLower,
  );
  if (!conversion) return { amount, unit };

  return { amount: amount * conversion[1], unit: group.baseUnit };
}

/**
 * Convert base unit back to a friendly unit if it's large enough.
 */
function fromBaseUnit(amount: number, baseUnit: string): { amount: number; unit: string } {
  if (baseUnit === 'g' && amount >= 1000) {
    return { amount: Math.round((amount / 1000) * 100) / 100, unit: 'kg' };
  }
  if (baseUnit === 'ml' && amount >= 1000) {
    return { amount: Math.round((amount / 1000) * 100) / 100, unit: 'l' };
  }
  return { amount: Math.round(amount * 100) / 100, unit: baseUnit };
}

// ─── Category detection ──────────────────────────────────────────────────────

function detectCategory(ingredientName: string): string {
  const lower = ingredientName.toLowerCase();

  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.length === 0) continue; // skip 'Sonstiges' in keyword scan
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }

  return 'Sonstiges';
}

// ─── Pantry staple check ─────────────────────────────────────────────────────

function isPantryStaple(ingredientName: string, pantryStaples: string[]): boolean {
  const lower = ingredientName.toLowerCase();
  return pantryStaples.some(staple => lower.includes(staple.toLowerCase()));
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Generate a merged, categorized shopping list for a week plan.
 */
export function generateShoppingList(
  planId: number,
  householdSize: number,
  hidePantryStaples: boolean,
  pantryStaples: string[],
  ownedIngredients: string[] = [],
): ShoppingItem[] {
  // Fetch all meal slots for this plan
  const slots = db.prepare(
    'SELECT * FROM meal_slots WHERE plan_id = ?',
  ).all(planId) as RawMealSlot[];

  if (slots.length === 0) return [];

  // Unique recipe IDs
  const recipeIds = [...new Set(slots.map(s => s.recipe_id))];

  // Fetch recipes
  const placeholders = recipeIds.map(() => '?').join(',');
  const rawRecipes = db.prepare(
    `SELECT id, title, servings, ingredients FROM recipes WHERE id IN (${placeholders})`,
  ).all(...recipeIds) as RawRecipe[];

  // Build recipe map
  const recipeMap = new Map<number, { title: string; servings: number; ingredients: Ingredient[] }>();
  for (const r of rawRecipes) {
    let ingredients: Ingredient[] = [];
    try {
      ingredients = JSON.parse(r.ingredients) as Ingredient[];
    } catch {
      ingredients = [];
    }
    recipeMap.set(r.id, { title: r.title, servings: r.servings || 4, ingredients });
  }

  // Count how many slots each recipe appears in (for scaling)
  const recipeSlotCount = new Map<number, number>();
  for (const slot of slots) {
    recipeSlotCount.set(slot.recipe_id, (recipeSlotCount.get(slot.recipe_id) || 0) + 1);
  }

  // ── Merge ingredients ────────────────────────────────────────────────────

  // Key: "normalizedIngredientName::baseUnit"
  interface MergeEntry {
    ingredient: string;
    totalBaseAmount: number;
    baseUnit: string;
    unitless: boolean;
    count: number; // for unitless items (e.g. "2 Eier")
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
        // No amount — just list as-is
        const key = `${normalized}::`;
        const existing = merged.get(key);
        if (existing) {
          existing.recipes.add(recipe.title);
        } else {
          merged.set(key, {
            ingredient: ing.item,
            totalBaseAmount: 0,
            baseUnit: '',
            unitless: true,
            count: 0,
            recipes: new Set([recipe.title]),
          });
        }
        continue;
      }

      const scaledAmount = Number(ing.amount) * scaleFactor;
      const unit = ing.unit || '';

      if (!unit) {
        // Unitless with number (e.g., "3 Eier")
        const key = `${normalized}::count`;
        const existing = merged.get(key);
        if (existing) {
          existing.count += scaledAmount;
          existing.totalBaseAmount += scaledAmount;
          existing.recipes.add(recipe.title);
        } else {
          merged.set(key, {
            ingredient: ing.item,
            totalBaseAmount: scaledAmount,
            baseUnit: '',
            unitless: false,
            count: scaledAmount,
            recipes: new Set([recipe.title]),
          });
        }
        continue;
      }

      // Convert to base unit
      const { amount: baseAmount, unit: baseUnit } = toBaseUnit(scaledAmount, unit);
      const key = `${normalized}::${baseUnit}`;
      const existing = merged.get(key);
      if (existing) {
        existing.totalBaseAmount += baseAmount;
        existing.recipes.add(recipe.title);
      } else {
        merged.set(key, {
          ingredient: ing.item,
          totalBaseAmount: baseAmount,
          baseUnit,
          unitless: false,
          count: 0,
          recipes: new Set([recipe.title]),
        });
      }
    }
  }

  // ── Build output ──────────────────────────────────────────────────────────

  const result: ShoppingItem[] = [];

  for (const entry of merged.values()) {
    const isOwned = ownedIngredients.some(o =>
      entry.ingredient.toLowerCase().includes(o.toLowerCase()),
    );
    const isStaple = isPantryStaple(entry.ingredient, pantryStaples);

    if (hidePantryStaples && isStaple) continue;

    let finalAmount: number | '' = '';
    let finalUnit = '';

    if (entry.unitless) {
      finalAmount = '';
      finalUnit = '';
    } else if (entry.count > 0 && !entry.baseUnit) {
      // Unitless count (Eier, etc.)
      finalAmount = Math.ceil(entry.count);
      finalUnit = '';
    } else if (entry.baseUnit) {
      const { amount, unit } = fromBaseUnit(entry.totalBaseAmount, entry.baseUnit);
      finalAmount = amount;
      finalUnit = unit;
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

  // Sort by category, then ingredient name
  const categoryOrder = CATEGORY_KEYWORDS.map(c => c.category);
  result.sort((a, b) => {
    const catA = categoryOrder.indexOf(a.category);
    const catB = categoryOrder.indexOf(b.category);
    if (catA !== catB) return catA - catB;
    return a.ingredient.localeCompare(b.ingredient, 'de');
  });

  return result;
}
