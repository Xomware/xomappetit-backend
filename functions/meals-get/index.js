'use strict';

const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, badRequest, notFound, serverError } = require('../../shared/response');
const { normalizeMeal } = require('../../shared/ingredients');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const mealId = body.id || body.mealId;
    if (!mealId) return badRequest('id is required');

    const { Item } = await docClient.send(
      new GetCommand({
        TableName: process.env.MEALS_TABLE_NAME,
        Key: { userId, mealId },
      })
    );

    if (!Item) return notFound('Meal not found');
    return ok(normalizeMeal(Item));
  } catch (err) {
    console.error('meals-get error:', err);
    return serverError(err.message);
  }
};
