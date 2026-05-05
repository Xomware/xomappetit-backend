'use strict';

const { findNutrition, toGrams } = require('./nutrition');
const { normalizeIngredients, normalizeServings, normalizeMacrosScope } = require('./ingredients');

/**
 * Estimate per-recipe macros from an ingredient list.
 *
 * Returns:
 *   {
 *     macros: { calories, protein, carbs, fat },     // rounded integers
 *     coverage: { matched, total, unmatched: string[] }  // diagnostic
 *   }
 *
 * macrosScope can be 'per-recipe' (default) or 'per-serving' — when
 * 'per-serving', we divide each macro by `servings` so the panel shows
 * what one diner gets.
 *
 * Ingredients we can't match against the nutrition table (free-form names
 * like 'fancy spice rub') get skipped and surface in `coverage.unmatched`
 * so the UI can show 'matched 8 of 10' confidence.
 */
function computeMacros(rawIngredients, opts = {}) {
  const ingredients = normalizeIngredients(rawIngredients);
  const servings = normalizeServings(opts.servings ?? 1);
  const scope = normalizeMacrosScope(opts.macrosScope ?? 'per-recipe');

  let cal = 0;
  let p = 0;
  let c = 0;
  let f = 0;
  let matched = 0;
  const unmatched = [];

  for (const ing of ingredients) {
    const hit = findNutrition(ing.name);
    if (!hit) {
      unmatched.push(ing.name);
      continue;
    }
    const grams = toGrams(ing.name, ing.amount, ing.unit);
    if (grams == null) {
      // Have nutrition but no convertible amount — skip, count as unmatched
      // so the UI can warn the user.
      unmatched.push(ing.name);
      continue;
    }
    const factor = grams / 100;
    cal += hit.value.cal * factor;
    p   += hit.value.p   * factor;
    c   += hit.value.c   * factor;
    f   += hit.value.f   * factor;
    matched++;
  }

  const divisor = scope === 'per-serving' ? servings : 1;
  const round = (n) => Math.max(0, Math.round((n / divisor) || 0));

  return {
    macros: {
      calories: round(cal),
      protein: round(p),
      carbs: round(c),
      fat: round(f),
    },
    macrosScope: scope,
    servings,
    coverage: {
      matched,
      total: ingredients.length,
      unmatched,
    },
  };
}

module.exports = { computeMacros };
