'use strict';

const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, badRequest, serverError } = require('../../shared/response');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const blockedUserId = body.blockedUserId;
    if (!blockedUserId) return badRequest('blockedUserId is required');

    await docClient.send(
      new DeleteCommand({
        TableName: process.env.BLOCKS_TABLE_NAME,
        Key: { userId, blockedUserId },
      })
    );

    return ok({ status: 'unblocked' });
  } catch (err) {
    console.error('blocks-remove error:', err);
    return serverError(err.message);
  }
};
