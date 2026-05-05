'use strict';

const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { blockedIdsOf } = require('../../shared/blocks');
const { ok, badRequest, serverError } = require('../../shared/response');
const { normalizeRecipe } = require('../../shared/ingredients');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/**
 * Search PUBLIC recipes by name + protein source (case-insensitive
 * contains). Hobby-scale scan + filter — promote to OpenSearch when
 * a couple of thousand recipes start lagging.
 *
 * Body: { q: string, limit?: number }
 * Returns: { items: Recipe[] }
 */
exports.handler = async (event) => {
  try {
    const callerId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const q = typeof body.q === 'string' ? body.q.trim().toLowerCase() : '';
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    if (!q || q.length < 2) return badRequest('q must be at least 2 characters');

    const [{ Items = [] }, blocked] = await Promise.all([
      docClient.send(
        new ScanCommand({
          TableName: process.env.RECIPES_TABLE_NAME,
          // Server-side filter to avoid pulling friends/private rows we'd
          // just throw away. lowercase comparison happens client-side
          // (DDB's contains is case-sensitive), so we over-fetch.
          FilterExpression: 'privacy = :pub',
          ExpressionAttributeValues: { ':pub': 'public' },
          Limit: 500,
        })
      ),
      blockedIdsOf(callerId),
    ]);

    const matches = Items.filter((r) => {
      if (blocked.has(r.authorUserId)) return false;
      const haystack = `${r.name || ''} ${r.proteinSource || ''}`.toLowerCase();
      return haystack.includes(q);
    });
    matches.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return ok({ items: matches.slice(0, limit).map(normalizeRecipe) });
  } catch (err) {
    console.error('recipes-search error:', err);
    return serverError(err.message);
  }
};
