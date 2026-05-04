'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, serverError } = require('../../shared/response');

/**
 * Returns the caller's friendship state in one shot:
 *
 *   {
 *     friends:           [{ userId, since }],            // accepted both ways
 *     incomingPending:   [{ userId, requestedAt }],      // they asked, awaiting my reply
 *     outgoingPending:   [{ userId, requestedAt }],      // I asked, awaiting their reply
 *   }
 *
 * Single source of truth — frontend doesn't need to call multiple
 * endpoints to render the /friends page.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);

    // Forward direction: rows where I'm the PK (userId) — my outgoing
    // pending + accepted entries.
    const forwardP = docClient.send(
      new QueryCommand({
        TableName: process.env.FRIENDSHIPS_TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
      })
    );

    // Reverse direction: rows where I'm the GSI hash (friendUserId) —
    // incoming requests + the mirror rows of accepted friendships.
    const reverseP = docClient.send(
      new QueryCommand({
        TableName: process.env.FRIENDSHIPS_TABLE_NAME,
        IndexName: 'friend-index',
        KeyConditionExpression: 'friendUserId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
      })
    );

    const [{ Items: forward = [] }, { Items: reverse = [] }] = await Promise.all([
      forwardP,
      reverseP,
    ]);

    const friends = forward
      .filter((r) => r.status === 'accepted')
      .map((r) => ({
        userId: r.friendUserId,
        since: r.acceptedAt || r.createdAt,
      }));

    const outgoingPending = forward
      .filter((r) => r.status === 'pending')
      .map((r) => ({
        userId: r.friendUserId,
        requestedAt: r.createdAt,
      }));

    // Incoming = reverse rows where THEY have a pending row pointing at me
    // (and no matching forward accepted row, which can't happen anyway since
    // accepted writes both directions).
    const incomingPending = reverse
      .filter((r) => r.status === 'pending')
      .map((r) => ({
        userId: r.userId, // they're the requester
        requestedAt: r.createdAt,
      }));

    return ok({ friends, incomingPending, outgoingPending });
  } catch (err) {
    console.error('friends-list error:', err);
    return serverError(err.message);
  }
};
