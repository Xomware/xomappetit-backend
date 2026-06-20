'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { isFriend } = require('../../shared/friendships');
const { blockExistsBetween } = require('../../shared/blocks');
const { ok, serverError } = require('../../shared/response');
const { normalizeRecipe } = require('../../shared/ingredients');

/**
 * List recipes by author via the `author-index` GSI, newest first.
 *
 *   - No body: caller's own recipes (all privacies).
 *   - body.authorUserId = "<sub>": that user's recipes, filtered by
 *     privacy according to the friendship state:
 *       * self      -> all
 *       * friend    -> public + friends
 *       * stranger  -> public only
 */
exports.handler = async (event) => {
  try {
    const callerId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const targetId = typeof body.authorUserId === 'string' && body.authorUserId
      ? body.authorUserId
      : callerId;
    const isSelf = targetId === callerId;

    // Don't enumerate a user's recipes across a block (either direction).
    if (!isSelf && (await blockExistsBetween(callerId, targetId))) {
      return ok([]);
    }

    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        IndexName: 'author-index',
        KeyConditionExpression: 'authorUserId = :uid',
        ExpressionAttributeValues: { ':uid': targetId },
        ScanIndexForward: false,
      })
    );

    let visible = Items;
    if (!isSelf) {
      const allowedPrivacies = (await isFriend(callerId, targetId))
        ? new Set(['public', 'friends'])
        : new Set(['public']);
      visible = Items.filter((r) => allowedPrivacies.has(r.privacy));
    }

    return ok(visible.map(normalizeRecipe));
  } catch (err) {
    console.error('recipes-list error:', err);
    return serverError(err.message);
  }
};
