'use strict';

const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { noContent, badRequest, notFound, serverError } = require('../../shared/response');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const mealId = body.id || body.mealId;
    if (!mealId) return badRequest('id is required');

    const { Attributes } = await docClient.send(
      new DeleteCommand({
        TableName: process.env.MEALS_TABLE_NAME,
        Key: { userId, mealId },
        ConditionExpression: 'attribute_exists(userId)',
        ReturnValues: 'ALL_OLD',
      })
    );

    if (!Attributes) return notFound('Meal not found');
    return noContent();
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return notFound('Meal not found');
    console.error('meals-delete error:', err);
    return serverError(err.message);
  }
};
