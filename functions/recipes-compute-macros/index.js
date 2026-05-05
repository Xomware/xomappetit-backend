'use strict';

const { ok, badRequest, serverError } = require('../../shared/response');
const { getUserId } = require('../../shared/auth');
const { computeMacros } = require('../../shared/macros-calc');

/**
 * POST /recipes/compute-macros
 *
 * Body: { ingredients: Ingredient[], servings?: number, macrosScope?: 'per-recipe'|'per-serving' }
 * Returns: { macros, macrosScope, servings, coverage }
 *
 * Pure function — no DB writes, just runs the static-table calculator over
 * whatever the caller sends. Used by the wizard's Macros step to suggest
 * values; the user can still edit the result before saving.
 */
exports.handler = async (event) => {
  try {
    getUserId(event); // require auth
    const body = JSON.parse(event.body || '{}');
    if (!Array.isArray(body.ingredients) || body.ingredients.length === 0) {
      return badRequest('ingredients array is required');
    }
    const result = computeMacros(body.ingredients, {
      servings: body.servings,
      macrosScope: body.macrosScope,
    });
    return ok(result);
  } catch (err) {
    console.error('recipes-compute-macros error:', err);
    return serverError(err.message || 'Compute failed');
  }
};
