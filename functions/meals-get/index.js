'use strict';

const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, notFound, serverError } = require('../../shared/response');
const { normalizeMeal } = require('../../shared/ingredients');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const mealId = event.pathParameters?.id;

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
