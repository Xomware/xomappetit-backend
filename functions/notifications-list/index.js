'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, badRequest, serverError } = require('../../shared/response');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * List the caller's notifications, newest first. Single-shot —
 * also returns the unread count so the bell badge has a number
 * without a second call.
 *
 * Body (all optional):
 *   { limit?: number  // 1..100, default 50
 *     cursor?: string // opaque, from prior response }
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    let cursor;
    if (typeof body.cursor === 'string' && body.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(body.cursor, 'base64').toString('utf8'));
      } catch {
        return badRequest('Invalid cursor');
      }
    }

    const { Items = [], LastEvaluatedKey } = await docClient.send(
      new QueryCommand({
        TableName: process.env.NOTIFICATIONS_TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ScanIndexForward: false, // newest first
        Limit: limit,
        ExclusiveStartKey: cursor,
      })
    );

    // Unread count is for THIS page only — frontend can sum across pages
    // if it cares. Cheap and correct without an extra GSI for now.
    const unreadInPage = Items.filter((n) => n.read === false).length;

    const nextCursor = LastEvaluatedKey
      ? Buffer.from(JSON.stringify(LastEvaluatedKey)).toString('base64')
      : null;

    return ok({ items: Items, nextCursor, unreadInPage });
  } catch (err) {
    console.error('notifications-list error:', err);
    return serverError(err.message);
  }
};
