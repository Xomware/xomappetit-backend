'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, serverError } = require('../../shared/response');

exports.handler = async (event) => {
  try {
    getUserId(event);
    const mealId = event.pathParameters?.id;

    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.COMMENTS_TABLE_NAME,
        KeyConditionExpression: 'mealId = :mid',
        ExpressionAttributeValues: { ':mid': mealId },
      })
    );

    Items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    return ok(Items);
  } catch (err) {
    console.error('meals-comments-list error:', err);
    return serverError(err.message);
  }
};
