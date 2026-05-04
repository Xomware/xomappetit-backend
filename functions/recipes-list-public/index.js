'use strict';

const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { ok, serverError } = require('../../shared/response');
const { normalizeRecipe } = require('../../shared/ingredients');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Global feed of `privacy = 'public'` recipes, newest first.
 *
 * Implementation note: scan + filter at hobby scale is fine — recipe
 * count is in the low hundreds at worst. When this stops being free we
 * promote `privacy` to a GSI hash key (e.g. `feed-index` PK=feedBucket
 * SK=createdAt) and switch to Query.
 *
 * Body (all optional):
 *   { limit?: number,         // 1..100, default 50
 *     cursor?: string }       // opaque, from a prior response's nextCursor
 *
 * Auth: any authenticated caller. Privacy is the gate, not identity.
 */
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = typeof body.cursor === 'string' && body.cursor
      ? JSON.parse(Buffer.from(body.cursor, 'base64').toString('utf8'))
      : undefined;

    const { Items = [], LastEvaluatedKey } = await docClient.send(
      new ScanCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        FilterExpression: 'privacy = :pub',
        ExpressionAttributeValues: { ':pub': 'public' },
        ExclusiveStartKey: cursor,
        // Over-fetch a bit so the post-filter result is closer to `limit`;
        // capped to avoid runaway pages.
        Limit: Math.min(limit * 4, 500),
      })
    );

    Items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const trimmed = Items.slice(0, limit);

    const nextCursor = LastEvaluatedKey
      ? Buffer.from(JSON.stringify(LastEvaluatedKey)).toString('base64')
      : null;

    return ok({
      items: trimmed.map(normalizeRecipe),
      nextCursor,
    });
  } catch (err) {
    console.error('recipes-list-public error:', err);
    return serverError(err.message);
  }
};
