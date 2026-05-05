'use strict';

const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  ok,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');
const {
  normalizeIngredients,
  normalizeInstructions,
  normalizeProteinTypes,
  normalizeTags,
  normalizeDifficulty,
  normalizeServings,
  normalizeMacrosScope,
  normalizeMacros,
  normalizeRecipe,
} = require('../../shared/ingredients');
const { detectProteinTypes } = require('../../shared/protein-detect');

const EDITABLE_FIELDS = new Set([
  'name',
  'description',
  'timeMinutes',
  'difficulty',
  'servings',
  'proteinSource',
  'proteinTypes',
  'tags',
  'ingredients',
  'instructions',
  'macros',
  'macrosScope',
  'privacy',
]);

const VALID_PRIVACY = new Set(['public', 'friends', 'private']);

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.id || body.recipeId;
    if (!recipeId) return badRequest('id is required');

    const { Item } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
      })
    );
    if (!Item) return notFound('Recipe not found');
    if (Item.authorUserId !== userId) return forbidden('Only the author can edit this recipe');

    const updates = {};
    for (const key of Object.keys(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      switch (key) {
        case 'ingredients':
          updates.ingredients = normalizeIngredients(body.ingredients);
          break;
        case 'instructions':
          updates.instructions = normalizeInstructions(body.instructions);
          break;
        case 'proteinTypes':
          updates.proteinTypes = normalizeProteinTypes(body.proteinTypes);
          break;
        case 'tags':
          updates.tags = normalizeTags(body.tags);
          break;
        case 'difficulty':
          updates.difficulty = normalizeDifficulty(body.difficulty);
          break;
        case 'servings':
          updates.servings = normalizeServings(body.servings);
          break;
        case 'macros':
          updates.macros = normalizeMacros(body.macros);
          break;
        case 'macrosScope':
          updates.macrosScope = normalizeMacrosScope(body.macrosScope);
          break;
        case 'privacy':
          if (!VALID_PRIVACY.has(body.privacy)) {
            return badRequest('privacy must be one of public | friends | private');
          }
          updates.privacy = body.privacy;
          break;
        default:
          updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return badRequest('No editable fields provided');
    }

    // If ingredients changed but the caller didn't explicitly override
    // proteinTypes, re-derive proteins from the new ingredient list. Keeps
    // the recipe's "this contains chicken" tag honest after edits.
    if (updates.ingredients && !('proteinTypes' in body)) {
      updates.proteinTypes = detectProteinTypes(updates.ingredients);
    }

    updates.updatedAt = new Date().toISOString();

    const setExpressions = [];
    const exprNames = {};
    const exprValues = { ':authorUserId': userId };
    for (const [k, v] of Object.entries(updates)) {
      setExpressions.push(`#${k} = :${k}`);
      exprNames[`#${k}`] = k;
      exprValues[`:${k}`] = v;
    }

    const { Attributes } = await docClient.send(
      new UpdateCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
        UpdateExpression: `SET ${setExpressions.join(', ')}`,
        ConditionExpression: 'authorUserId = :authorUserId',
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return ok(normalizeRecipe(Attributes));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return forbidden('Only the author can edit this recipe');
    }
    console.error('recipes-edit error:', err);
    return serverError(err.message);
  }
};
