'use strict';

const {
  QueryCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, badRequest, serverError } = require('../../shared/response');

/**
 * Mark notifications as read.
 *
 *   { sortKey: "<...>" }   single notification
 *   { all: true }          everything currently unread for the caller
 *
 * Caller can only modify their own notifications (PK is userId =
 * caller; conditional update isn't necessary because the only way to
 * hit another user's row would be to forge sortKey under your own PK,
 * which by construction can only mark YOUR rows).
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const TABLE = process.env.NOTIFICATIONS_TABLE_NAME;

    if (body.all === true) {
      // Page through all unread rows and flip them. At hobby scale
      // this is cheap; at scale we'd want a per-user counter or batch
      // job.
      let cursor;
      let updated = 0;
      do {
        const res = await docClient.send(
          new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'userId = :uid',
            FilterExpression: '#r = :f',
            ExpressionAttributeNames: { '#r': 'read' },
            ExpressionAttributeValues: { ':uid': userId, ':f': false },
            ExclusiveStartKey: cursor,
          })
        );
        for (const item of res.Items || []) {
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE,
              Key: { userId, sortKey: item.sortKey },
              UpdateExpression: 'SET #r = :t',
              ExpressionAttributeNames: { '#r': 'read' },
              ExpressionAttributeValues: { ':t': true },
            })
          );
          updated += 1;
        }
        cursor = res.LastEvaluatedKey;
      } while (cursor);
      return ok({ updated });
    }

    if (typeof body.sortKey !== 'string' || !body.sortKey) {
      return badRequest('sortKey is required (or pass all=true)');
    }

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { userId, sortKey: body.sortKey },
        UpdateExpression: 'SET #r = :t',
        ExpressionAttributeNames: { '#r': 'read' },
        ExpressionAttributeValues: { ':t': true },
      })
    );
    return ok({ updated: 1 });
  } catch (err) {
    console.error('notifications-mark-read error:', err);
    return serverError(err.message);
  }
};
