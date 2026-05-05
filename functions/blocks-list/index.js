'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, serverError } = require('../../shared/response');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.BLOCKS_TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
      })
    );
    return ok({
      blocked: Items.map((r) => ({
        userId: r.blockedUserId,
        blockedAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('blocks-list error:', err);
    return serverError(err.message);
  }
};
