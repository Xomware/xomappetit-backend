'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, serverError } = require('../../shared/response');
const { normalizeRecipe } = require('../../shared/ingredients');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const PER_AUTHOR_LIMIT = 20;

/**
 * Feed of recipes from the caller + their accepted friends, newest first.
 *
 * Read-time fan-out: query the friendships table for the caller's
 * accepted friends, then query the recipes author-index GSI for each
 * (parallel). At hobby scale most users have <50 friends so this is
 * fine; promote to a per-user feed table when it stops being free.
 *
 * Privacy: include public + friends recipes from friends, all from
 * caller. Private recipes from anyone except the caller are filtered.
 *
 * Body (all optional):
 *   { limit?: number   // 1..100, default 50 }
 *
 * Pagination is per-author capped (PER_AUTHOR_LIMIT) and the merged
 * result is trimmed to `limit`. Cursor not exposed for v1 — feed is
 * "what's new in the last burst", not infinite scroll.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // 1. Find accepted friends.
    const { Items: friendRows = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.FRIENDSHIPS_TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: '#st = :ok',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':uid': userId, ':ok': 'accepted' },
      })
    );
    const friendIds = friendRows.map((r) => r.friendUserId);

    // 2. Fan-out queries: caller + each friend, in parallel.
    const authorIds = [userId, ...friendIds];
    const queries = authorIds.map((aid) =>
      docClient.send(
        new QueryCommand({
          TableName: process.env.RECIPES_TABLE_NAME,
          IndexName: 'author-index',
          KeyConditionExpression: 'authorUserId = :uid',
          ExpressionAttributeValues: { ':uid': aid },
          ScanIndexForward: false,
          Limit: PER_AUTHOR_LIMIT,
        })
      )
    );
    const results = await Promise.all(queries);

    // 3. Merge + privacy filter (private recipes only visible to author).
    const merged = [];
    results.forEach((res, i) => {
      const aid = authorIds[i];
      const isSelf = aid === userId;
      for (const r of res.Items || []) {
        if (!isSelf && r.privacy === 'private') continue;
        merged.push(r);
      }
    });

    merged.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const trimmed = merged.slice(0, limit);

    return ok({
      items: trimmed.map(normalizeRecipe),
      friendCount: friendIds.length,
    });
  } catch (err) {
    console.error('friends-feed error:', err);
    return serverError(err.message);
  }
};
