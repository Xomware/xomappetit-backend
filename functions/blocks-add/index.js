'use strict';

const { PutCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, badRequest, serverError } = require('../../shared/response');

/**
 * Block a user. Body: { blockedUserId }.
 *
 * Side effect: also remove any existing friendship in both directions
 * (you can't be friends AND blocked). Outgoing/incoming pending
 * requests are also cleaned up.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const blockedUserId = body.blockedUserId;
    if (!blockedUserId || typeof blockedUserId !== 'string') {
      return badRequest('blockedUserId is required');
    }
    if (blockedUserId === userId) {
      return badRequest("Can't block yourself");
    }

    const now = new Date().toISOString();

    // Write block + clear both friendship rows (idempotent — Delete on a
    // non-existent row is a no-op inside a TransactWrite).
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: process.env.BLOCKS_TABLE_NAME,
              Item: { userId, blockedUserId, createdAt: now },
            },
          },
          {
            Delete: {
              TableName: process.env.FRIENDSHIPS_TABLE_NAME,
              Key: { userId, friendUserId: blockedUserId },
            },
          },
          {
            Delete: {
              TableName: process.env.FRIENDSHIPS_TABLE_NAME,
              Key: { userId: blockedUserId, friendUserId: userId },
            },
          },
        ],
      })
    );

    return ok({ status: 'blocked' });
  } catch (err) {
    console.error('blocks-add error:', err);
    return serverError(err.message);
  }
};
