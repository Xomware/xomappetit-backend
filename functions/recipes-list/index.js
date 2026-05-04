'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, serverError } = require('../../shared/response');
const { normalizeRecipe } = require('../../shared/ingredients');

/**
 * List the caller's recipes via the author-index GSI, newest first.
 *
 * v1 scope: caller's recipes only — no public feed yet (Phase 1.5).
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);

    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        IndexName: 'author-index',
        KeyConditionExpression: 'authorUserId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ScanIndexForward: false, // newest first
      })
    );

    return ok(Items.map(normalizeRecipe));
  } catch (err) {
    console.error('recipes-list error:', err);
    return serverError(err.message);
  }
};
