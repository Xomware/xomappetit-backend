'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, serverError } = require('../../shared/response');
const { normalizeRecipe } = require('../../shared/ingredients');

/**
 * List recipes by author via the `author-index` GSI, newest first.
 *
 *   - No body: returns the caller's own recipes (all privacies).
 *   - body.authorUserId = "<sub>": returns that user's recipes,
 *     filtered to `privacy = 'public'` if they're not the caller.
 *     Friends-only is treated as private until the friends feature
 *     ships (matches recipes-get's stub behavior).
 */
exports.handler = async (event) => {
  try {
    const callerId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const targetId = typeof body.authorUserId === 'string' && body.authorUserId
      ? body.authorUserId
      : callerId;
    const isSelf = targetId === callerId;

    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        IndexName: 'author-index',
        KeyConditionExpression: 'authorUserId = :uid',
        ExpressionAttributeValues: { ':uid': targetId },
        ScanIndexForward: false, // newest first
      })
    );

    const visible = isSelf
      ? Items
      : Items.filter((r) => r.privacy === 'public');

    return ok(visible.map(normalizeRecipe));
  } catch (err) {
    console.error('recipes-list error:', err);
    return serverError(err.message);
  }
};
