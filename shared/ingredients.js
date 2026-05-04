'use strict';

const normalizeIngredient = (ingredient) => {
  if (typeof ingredient === 'string') {
    return { name: ingredient, quantity: null, unit: null };
  }
  if (ingredient && typeof ingredient === 'object') {
    return {
      name: String(ingredient.name || '').trim(),
      quantity: ingredient.quantity ?? null,
      unit: ingredient.unit ? String(ingredient.unit).trim() : null,
    };
  }
  return { name: '', quantity: null, unit: null };
};

const normalizeIngredients = (ingredients) => {
  if (!Array.isArray(ingredients)) return [];
  return ingredients.map(normalizeIngredient).filter((i) => i.name);
};

const normalizeRecipe = (recipe) => {
  if (!recipe) return recipe;
  return {
    ...recipe,
    ingredients: normalizeIngredients(recipe.ingredients),
    instructions: Array.isArray(recipe.instructions) ? recipe.instructions : [],
  };
};

module.exports = { normalizeIngredient, normalizeIngredients, normalizeRecipe };
