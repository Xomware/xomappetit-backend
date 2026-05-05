'use strict';

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { created, badRequest, serverError } = require('../../shared/response');
const {
  normalizeIngredients,
  normalizeInstructions,
  normalizeProteinTypes,
  normalizeTags,
  normalizeDifficulty,
  normalizeServings,
  normalizeMacrosScope,
  normalizeMacros,
} = require('../../shared/ingredients');
const { detectProteinTypes } = require('../../shared/protein-detect');

const VALID_PRIVACY = new Set(['public', 'friends', 'private']);

/**
 * Pull the author's handle from the JWT id-token claims (preferred_username).
 */
function authorHandleFromEvent(event) {
  const claims = event?.requestContext?.authorizer?.claims;
  const v = claims?.['preferred_username'];
  return typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;
}

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return badRequest('name is required');
    }

    const privacy = VALID_PRIVACY.has(body.privacy) ? body.privacy : 'public';
    const now = new Date().toISOString();
    const authorHandle = authorHandleFromEvent(event);

    const recipe = {
      recipeId: uuidv4(),
      authorUserId: userId,
      authorHandle,
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : '',
      timeMinutes: Number.isFinite(body.timeMinutes) ? body.timeMinutes : 0,
      servings: normalizeServings(body.servings ?? 1),
      // Difficulty: 1..5 integer (replaces legacy string enum but accepts both via normalizer).
      difficulty: normalizeDifficulty(body.difficulty),
      // Free-text proteinSource kept for back-compat / search; new structured field is proteinTypes.
      proteinSource: typeof body.proteinSource === 'string' ? body.proteinSource : '',
      // proteinTypes is derived from the ingredient list — the user shouldn't
      // have to repeat themselves. Honor an explicit override if the caller
      // (typically the importer) sent a non-empty list.
      proteinTypes: (() => {
        const fromBody = normalizeProteinTypes(body.proteinTypes ?? []);
        if (fromBody.length > 0) return fromBody;
        return detectProteinTypes(normalizeIngredients(body.ingredients));
      })(),
      tags: normalizeTags(body.tags ?? []),
      ingredients: normalizeIngredients(body.ingredients),
      instructions: normalizeInstructions(body.instructions),
      macros: normalizeMacros(body.macros),
      macrosScope: normalizeMacrosScope(body.macrosScope),
      privacy,
      createdAt: now,
      updatedAt: now,
      cookCount: 0,
      avgRating: null,
      ratingCount: 0,
      spicinessAvg: null,
      spicinessCount: 0,
      sweetnessAvg: null,
      sweetnessCount: 0,
      saltinessAvg: null,
      saltinessCount: 0,
      richnessAvg: null,
      richnessCount: 0,
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Item: recipe,
      })
    );

    return created(recipe);
  } catch (err) {
    console.error('recipes-create error:', err);
    return serverError(err.message);
  }
};
