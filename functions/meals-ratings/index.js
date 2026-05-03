'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, badRequest, serverError } = require('../../shared/response');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const mealId = body.id || body.mealId;
    if (!mealId) return badRequest('id is required');

    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.RATINGS_TABLE_NAME,
        KeyConditionExpression: 'userId = :uid AND mealId = :mid',
        ExpressionAttributeValues: { ':uid': userId, ':mid': mealId },
      })
    );

    return ok(Items);
  } catch (err) {
    console.error('meals-ratings error:', err);
    return serverError(err.message);
  }
};
