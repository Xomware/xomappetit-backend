'use strict';

// ---------- Enums ----------

const PROTEIN_TYPES = new Set([
  'chicken', 'beef', 'pork', 'turkey', 'lamb',
  'fish', 'salmon', 'tuna', 'shrimp', 'shellfish',
  'tofu', 'tempeh', 'seitan',
  'beans', 'lentils', 'chickpeas',
  'eggs', 'dairy', 'nuts',
  'none', 'other',
]);

const UNITS = new Set([
  'count', 'g', 'kg', 'oz', 'lb', 'ml', 'l',
  'cup', 'tbsp', 'tsp', 'clove', 'pinch', 'dash',
  'slice', 'can', 'to-taste',
]);

// Units that don't take a numeric amount.
const UNITLESS = new Set(['to-taste', 'pinch', 'dash']);

const TAGS = new Set([
  // Diets
  'vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free',
  'low-carb', 'keto', 'paleo', 'high-protein', 'low-calorie',
  // Flavor / heat
  'spicy', 'sweet', 'savory',
  // Meal type
  'breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'appetizer',
  'side', 'main', 'soup', 'salad',
  // Method
  'baking', 'grilling', 'slow-cooker', 'instant-pot', 'one-pan', 'no-cook',
  // Vibe
  'meal-prep', 'quick', 'date-night', 'comfort', 'kid-friendly',
]);

const MACROS_SCOPES = new Set(['per-serving', 'per-recipe']);

// Default amount per unit for the "suggest a quantity when I pick a unit" UX.
// UI uses these to prefill; users can still override.
const UNIT_DEFAULT_AMOUNTS = {
  count: 1, g: 100, kg: 1, oz: 4, lb: 1, ml: 250, l: 1,
  cup: 1, tbsp: 1, tsp: 1, clove: 1, slice: 1, can: 1,
  pinch: null, dash: null, 'to-taste': null,
};

// ---------- Normalizers ----------

function normalizeUnit(v) {
  if (v === null || v === undefined || v === '') return null;
  const u = String(v).trim().toLowerCase();
  return UNITS.has(u) ? u : null;
}

function normalizeAmount(v, unit) {
  if (unit && UNITLESS.has(unit)) return null;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeIngredient(ingredient) {
  if (typeof ingredient === 'string') {
    return { name: ingredient.trim(), amount: null, unit: null };
  }
  if (ingredient && typeof ingredient === 'object') {
    const unit = normalizeUnit(ingredient.unit);
    // Accept either `amount` (new) or legacy `quantity` for back-compat.
    const rawAmount = ingredient.amount ?? ingredient.quantity ?? null;
    return {
      name: String(ingredient.name || '').trim(),
      amount: normalizeAmount(rawAmount, unit),
      unit,
    };
  }
  return { name: '', amount: null, unit: null };
}

function normalizeIngredients(ingredients) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients.map(normalizeIngredient).filter((i) => i.name);
}

function normalizeInstruction(step) {
  if (typeof step === 'string') {
    return { text: step.trim(), ingredientIndexes: [] };
  }
  if (step && typeof step === 'object') {
    return {
      text: String(step.text || '').trim(),
      ingredientIndexes: Array.isArray(step.ingredientIndexes)
        ? step.ingredientIndexes
            .filter((n) => Number.isInteger(n) && n >= 0)
            .slice(0, 50)
        : [],
    };
  }
  return { text: '', ingredientIndexes: [] };
}

function normalizeInstructions(instructions) {
  if (!Array.isArray(instructions)) return [];
  return instructions.map(normalizeInstruction).filter((s) => s.text);
}

function normalizeProteinTypes(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  for (const raw of v) {
    const t = String(raw || '').trim().toLowerCase();
    if (PROTEIN_TYPES.has(t)) seen.add(t);
  }
  return Array.from(seen);
}

function normalizeTags(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  for (const raw of v) {
    const t = String(raw || '').trim().toLowerCase();
    if (TAGS.has(t)) seen.add(t);
  }
  return Array.from(seen);
}

// Difficulty: 1..5 integer. Migrate legacy strings in case any pre-existing
// rows still have 'Easy' / 'Medium' / 'Hard'.
function normalizeDifficulty(v) {
  const map = { Easy: 2, Medium: 3, Hard: 4 };
  if (typeof v === 'string' && v in map) return map[v];
  const n = Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizeServings(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(50, Math.round(n));
}

function normalizeMacrosScope(v) {
  return MACROS_SCOPES.has(v) ? v : 'per-recipe';
}

function normalizeMacros(m) {
  if (!m || typeof m !== 'object') {
    return { calories: 0, protein: 0, carbs: 0, fat: 0 };
  }
  const num = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Number(x)) : 0);
  return {
    calories: num(m.calories),
    protein: num(m.protein),
    carbs: num(m.carbs),
    fat: num(m.fat),
  };
}

/**
 * Read-side recipe normalizer. Backfills new taxonomy fields with sane
 * defaults so older rows render without breaking the UI.
 */
function normalizeRecipe(recipe) {
  if (!recipe) return recipe;
  return {
    ...recipe,
    ingredients: normalizeIngredients(recipe.ingredients),
    instructions: normalizeInstructions(recipe.instructions),
    servings: normalizeServings(recipe.servings ?? 1),
    proteinTypes: normalizeProteinTypes(recipe.proteinTypes ?? []),
    tags: normalizeTags(recipe.tags ?? []),
    difficulty: normalizeDifficulty(recipe.difficulty),
    macros: normalizeMacros(recipe.macros),
    macrosScope: normalizeMacrosScope(recipe.macrosScope),
    spicinessAvg: recipe.spicinessAvg ?? null,
    spicinessCount: Number.isFinite(recipe.spicinessCount) ? recipe.spicinessCount : 0,
  };
}

module.exports = {
  // Enums (exported so other lambdas can validate against the same source)
  PROTEIN_TYPES,
  UNITS,
  UNITLESS,
  TAGS,
  MACROS_SCOPES,
  UNIT_DEFAULT_AMOUNTS,
  // Normalizers
  normalizeUnit,
  normalizeAmount,
  normalizeIngredient,
  normalizeIngredients,
  normalizeInstruction,
  normalizeInstructions,
  normalizeProteinTypes,
  normalizeTags,
  normalizeDifficulty,
  normalizeServings,
  normalizeMacrosScope,
  normalizeMacros,
  normalizeRecipe,
};
