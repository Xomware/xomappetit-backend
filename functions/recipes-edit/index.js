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
  normalizeRecipe,
} = require('../../shared/ingredients');

const EDITABLE_FIELDS = new Set([
  'name',
  'description',
  'timeMinutes',
  'difficulty',
  'proteinSource',
  'ingredients',
  'instructions',
  'macros',
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
      if (key === 'ingredients') {
        updates.ingredients = normalizeIngredients(body.ingredients);
      } else if (key === 'instructions') {
        updates.instructions = Array.isArray(body.instructions) ? body.instructions : [];
      } else if (key === 'privacy') {
        if (!VALID_PRIVACY.has(body.privacy)) {
          return badRequest('privacy must be one of public | friends | private');
        }
        updates.privacy = body.privacy;
      } else {
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return badRequest('No editable fields provided');
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
