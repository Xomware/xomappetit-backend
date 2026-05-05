'use strict';

const {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { isFriend } = require('../../shared/friendships');
const {
  ok,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');

/**
 * Toggle a like on a recipe.
 *
 *   - If the (recipeId, userId) row exists  -> delete + decrement count
 *   - If it doesn't                          -> put + increment count
 *
 * Returns { likeCount, likedByMe } for optimistic UI updates.
 *
 * Privacy gate matches recipes-get: public visible to all; friends
 * visible to author + friends; private only to author.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.recipeId || body.id;
    if (!recipeId) return badRequest('recipeId is required');

    // Privacy check.
    const { Item: recipe } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
      })
    );
    if (!recipe) return notFound('Recipe not found');
    const isAuthor = recipe.authorUserId === userId;
    if (recipe.privacy === 'private' && !isAuthor) {
      return forbidden('Recipe is private');
    }
    if (recipe.privacy === 'friends' && !isAuthor) {
      const friends = await isFriend(userId, recipe.authorUserId);
      if (!friends) return forbidden('Friends-only recipe');
    }

    // Toggle.
    const TABLE = process.env.RECIPE_LIKES_TABLE_NAME;
    const { Item: existing } = await docClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { recipeId, userId },
      })
    );

    const now = new Date().toISOString();
    let likedByMe;
    if (existing) {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE,
          Key: { recipeId, userId },
        })
      );
      likedByMe = false;
    } else {
      await docClient.send(
        new PutCommand({
          TableName: TABLE,
          Item: { recipeId, userId, likedAt: now },
        })
      );
      likedByMe = true;
    }

    // Update denormalized count on the recipe row.
    const delta = likedByMe ? 1 : -1;
    const { Attributes } = await docClient.send(
      new UpdateCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
        UpdateExpression: 'SET likeCount = if_not_exists(likeCount, :zero) + :d, updatedAt = :now',
        ConditionExpression: likedByMe
          ? 'attribute_exists(recipeId)'
          // Don't let the count go negative — clamp at 0 if we're decrementing.
          : 'attribute_exists(recipeId) AND if_not_exists(likeCount, :zero) > :zero',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':d': delta,
          ':now': now,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return ok({
      recipeId,
      likeCount: Attributes?.likeCount ?? 0,
      likedByMe,
    });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Decrement attempted on a 0-counter — re-read and report current state.
      try {
        const body = JSON.parse(event.body || '{}');
        const recipeId = body.recipeId || body.id;
        const { Item } = await docClient.send(
          new GetCommand({
            TableName: process.env.RECIPES_TABLE_NAME,
            Key: { recipeId },
          })
        );
        return ok({
          recipeId,
          likeCount: Item?.likeCount ?? 0,
          likedByMe: false,
        });
      } catch (_) { /* fall through */ }
    }
    console.error('recipes-like error:', err);
    return serverError(err.message);
  }
};
