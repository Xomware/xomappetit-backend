'use strict';

const {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { notify } = require('../../shared/notifications');
const {
  ok,
  badRequest,
  forbidden,
  serverError,
} = require('../../shared/response');

/**
 * Send a friend request — body { friendUserId }.
 *
 * Three cases:
 *   1. They already requested ME (reverse pending exists) → instant friendship,
 *      flip both rows to accepted in a single transaction.
 *   2. We're already friends → 200 no-op.
 *   3. Otherwise → write my outgoing pending row.
 *
 * Frontend resolves handle -> userId via xomware /users/get-by-handle before
 * calling this; the friendships table never sees handles.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const friendUserId = body.friendUserId;

    if (!friendUserId || typeof friendUserId !== 'string') {
      return badRequest('friendUserId is required');
    }
    if (friendUserId === userId) {
      return badRequest("Can't friend yourself");
    }

    const TABLE = process.env.FRIENDSHIPS_TABLE_NAME;
    const BLOCKS = process.env.BLOCKS_TABLE_NAME;

    // Check existing friendship rows in both directions + block rows in both
    // directions, all in parallel.
    const [
      { Item: forward },
      { Item: reverse },
      { Item: theyBlockedMe },
      { Item: iBlockedThem },
    ] = await Promise.all([
      docClient.send(
        new GetCommand({
          TableName: TABLE,
          Key: { userId, friendUserId },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: TABLE,
          Key: { userId: friendUserId, friendUserId: userId },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: BLOCKS,
          Key: { userId: friendUserId, blockedUserId: userId },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: BLOCKS,
          Key: { userId, blockedUserId: friendUserId },
        })
      ),
    ]);

    // Can't befriend across a block in either direction. Use a generic
    // message for "they blocked me" so it doesn't reveal the block.
    if (theyBlockedMe) return forbidden('Cannot send a friend request to this user');
    if (iBlockedThem) return badRequest('Unblock this user before sending a friend request');

    const now = new Date().toISOString();

    // Already friends — either accepted row is enough. (Guarding on a single
    // accepted row prevents a half-present friendship from being silently
    // downgraded to pending by the plain-Put path below.)
    if (forward?.status === 'accepted' || reverse?.status === 'accepted') {
      return ok({ status: 'accepted', alreadyFriends: true });
    }

    // I already sent a pending request.
    if (forward?.status === 'pending') {
      return ok({ status: 'pending', alreadyRequested: true });
    }

    // They sent ME a pending request — accept it instantly (mutual add).
    if (reverse?.status === 'pending') {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE,
                Item: {
                  userId,
                  friendUserId,
                  status: 'accepted',
                  createdAt: now,
                  acceptedAt: now,
                },
              },
            },
            {
              Put: {
                TableName: TABLE,
                Item: {
                  userId: friendUserId,
                  friendUserId: userId,
                  status: 'accepted',
                  createdAt: reverse.createdAt,
                  acceptedAt: now,
                },
              },
            },
          ],
        })
      );
      // Mutual: tell the original requester that we accepted.
      await notify({
        userId: friendUserId,
        type: 'friend_accept',
        actorUserId: userId,
        refType: 'friend',
        refId: userId,
      });
      return ok({ status: 'accepted', mutualRequest: true });
    }

    // Plain new outgoing request.
    await docClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          userId,
          friendUserId,
          status: 'pending',
          createdAt: now,
        },
      })
    );

    await notify({
      userId: friendUserId,
      type: 'friend_request',
      actorUserId: userId,
      refType: 'friend',
      refId: userId,
    });

    return ok({ status: 'pending' });
  } catch (err) {
    console.error('friends-add error:', err);
    if (err.name === 'ConditionalCheckFailedException') {
      return forbidden('Friendship state changed underneath; retry');
    }
    return serverError(err.message);
  }
};
