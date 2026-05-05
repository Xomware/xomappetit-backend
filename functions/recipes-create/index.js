'use strict';

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { created, badRequest, serverError } = require('../../shared/response');
const { normalizeIngredients } = require('../../shared/ingredients');

const VALID_PRIVACY = new Set(['public', 'friends', 'private']);

/**
 * Pull the author's handle from the JWT id-token claims (preferred_username).
 * For native users this is the @-handle they picked at sign-up. For federated
 * users without a handle yet it'll be undefined — frontend falls back gracefully.
 *
 * Avatar/displayName aren't in the JWT (they live in xomware-users) — leaving
 * those for a future cross-table read. The handle alone is enough to render
 * "by @handle" + link to /u/view?handle=...
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
      authorHandle, // denormalized — eventual-consistent if user changes handle later
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : '',
      timeMinutes: Number.isFinite(body.timeMinutes) ? body.timeMinutes : 0,
      difficulty: body.difficulty || 'Easy',
      proteinSource: body.proteinSource || '',
      ingredients: normalizeIngredients(body.ingredients),
      instructions: Array.isArray(body.instructions) ? body.instructions : [],
      macros: body.macros || { calories: 0, protein: 0, carbs: 0, fat: 0 },
      privacy,
      createdAt: now,
      updatedAt: now,
      cookCount: 0,
      avgRating: null,
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
