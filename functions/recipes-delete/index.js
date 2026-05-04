'use strict';

const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  noContent,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');

/**
 * Delete a recipe (author-only).
 *
 * Conditional delete on `authorUserId = :uid`. The conditional check distinguishes
 * "not found" from "exists but you're not the author" via a follow-up read on
 * failure — but at hobby scale we just collapse both into 404 to avoid leaking
 * the existence of a private/foreign recipe.
 *
 * Note: this does NOT cascade-delete cooks, ratings, or comments. Those become
 * orphaned records (cleanup is a future GC pass).
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.id || body.recipeId;
    if (!recipeId) return badRequest('id is required');

    try {
      await docClient.send(
        new DeleteCommand({
          TableName: process.env.RECIPES_TABLE_NAME,
          Key: { recipeId },
          ConditionExpression: 'attribute_exists(recipeId) AND authorUserId = :uid',
          ExpressionAttributeValues: { ':uid': userId },
        })
      );
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return notFound('Recipe not found');
      }
      throw err;
    }

    return noContent();
  } catch (err) {
    console.error('recipes-delete error:', err);
    return serverError(err.message);
  }
};
