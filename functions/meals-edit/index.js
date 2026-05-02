'use strict';

const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, badRequest, notFound, serverError } = require('../../shared/response');
const { normalizeIngredients, normalizeMeal } = require('../../shared/ingredients');

const EDITABLE_FIELDS = new Set([
  'name',
  'timeMinutes',
  'difficulty',
  'proteinSource',
  'ingredients',
  'instructions',
  'macros',
]);

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const mealId = event.pathParameters?.id;
    const body = JSON.parse(event.body || '{}');

    const { Item } = await docClient.send(
      new GetCommand({
        TableName: process.env.MEALS_TABLE_NAME,
        Key: { userId, mealId },
      })
    );
    if (!Item) return notFound('Meal not found');

    const updates = {};
    for (const key of Object.keys(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (key === 'ingredients') {
        updates.ingredients = normalizeIngredients(body.ingredients);
      } else if (key === 'instructions') {
        updates.instructions = Array.isArray(body.instructions) ? body.instructions : [];
      } else {
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return badRequest('No editable fields provided');
    }

    const setExpressions = [];
    const exprNames = {};
    const exprValues = {};
    for (const [k, v] of Object.entries(updates)) {
      setExpressions.push(`#${k} = :${k}`);
      exprNames[`#${k}`] = k;
      exprValues[`:${k}`] = v;
    }

    const { Attributes } = await docClient.send(
      new UpdateCommand({
        TableName: process.env.MEALS_TABLE_NAME,
        Key: { userId, mealId },
        UpdateExpression: `SET ${setExpressions.join(', ')}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return ok(normalizeMeal(Attributes));
  } catch (err) {
    console.error('meals-edit error:', err);
    return serverError(err.message);
  }
};
