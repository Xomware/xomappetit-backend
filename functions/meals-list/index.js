'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, serverError } = require('../../shared/response');
const { normalizeMeal } = require('../../shared/ingredients');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);

    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.MEALS_TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
      })
    );

    return ok(Items.map(normalizeMeal));
  } catch (err) {
    console.error('meals-list error:', err);
    return serverError(err.message);
  }
};
