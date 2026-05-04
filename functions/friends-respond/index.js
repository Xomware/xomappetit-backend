'use strict';

const {
  DeleteCommand,
  GetCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  ok,
  badRequest,
  notFound,
  serverError,
} = require('../../shared/response');

/**
 * Accept or decline an incoming friend request.
 * Body: { friendUserId, action: 'accept' | 'decline' }
 *
 * Accept: write the mirror row (me -> them, accepted) + flip their
 *         pending row to accepted. Both done in one transaction.
 * Decline: delete their pending row pointing at me. No mirror to write.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const { friendUserId, action } = body;

    if (!friendUserId) return badRequest('friendUserId is required');
    if (action !== 'accept' && action !== 'decline') {
      return badRequest("action must be 'accept' or 'decline'");
    }

    const TABLE = process.env.FRIENDSHIPS_TABLE_NAME;

    // Their pending row points at me: PK=their-id, SK=my-id.
    const { Item: theirRow } = await docClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { userId: friendUserId, friendUserId: userId },
      })
    );

    if (!theirRow || theirRow.status !== 'pending') {
      return notFound('No pending request from that user');
    }

    if (action === 'decline') {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE,
          Key: { userId: friendUserId, friendUserId: userId },
        })
      );
      return ok({ status: 'declined' });
    }

    const now = new Date().toISOString();
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Flip their pending row -> accepted
          {
            Put: {
              TableName: TABLE,
              Item: {
                userId: friendUserId,
                friendUserId: userId,
                status: 'accepted',
                createdAt: theirRow.createdAt,
                acceptedAt: now,
              },
            },
          },
          // Write the mirror row from my side
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
        ],
      })
    );

    return ok({ status: 'accepted' });
  } catch (err) {
    console.error('friends-respond error:', err);
    return serverError(err.message);
  }
};
