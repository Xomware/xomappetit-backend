'use strict';

const {
  DeleteCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  ok,
  badRequest,
  serverError,
} = require('../../shared/response');

/**
 * Cancel an outgoing pending request OR un-friend an accepted friend.
 * Body: { friendUserId }
 *
 * Idempotent: deletes both directions. If only one row exists (pending,
 * one direction) the other delete is a no-op.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const friendUserId = body.friendUserId;
    if (!friendUserId) return badRequest('friendUserId is required');

    const TABLE = process.env.FRIENDSHIPS_TABLE_NAME;

    // Both deletes in one transaction so we don't half-remove a friendship
    // and leave dangling state. Transaction tolerates rows that don't exist
    // (no condition expression).
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: TABLE,
              Key: { userId, friendUserId },
            },
          },
          {
            Delete: {
              TableName: TABLE,
              Key: { userId: friendUserId, friendUserId: userId },
            },
          },
        ],
      })
    );

    return ok({ status: 'removed' });
  } catch (err) {
    console.error('friends-remove error:', err);
    return serverError(err.message);
  }
};
