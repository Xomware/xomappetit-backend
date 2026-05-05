'use strict';

const { GetCommand } = require('@aws-sdk/lib-dynamodb');
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
const { normalizeRecipe } = require('../../shared/ingredients');

/**
 * Get a single recipe.
 *
 * Privacy:
 *   - public  → any authenticated caller
 *   - friends → author + accepted friends
 *   - private → author only
 *
 * Augments the returned row with `likedByMe: boolean` (single GetItem on
 * recipe-likes). `likeCount` lives on the recipe row itself, denormalized
 * by recipes-like.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.id || body.recipeId;
    if (!recipeId) return badRequest('id is required');

    const { Item } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
      })
    );
    if (!Item) return notFound('Recipe not found');

    const isAuthor = Item.authorUserId === userId;
    if (Item.privacy === 'private' && !isAuthor) {
      return forbidden('Recipe is private');
    }
    if (Item.privacy === 'friends' && !isAuthor) {
      const allowed = await isFriend(userId, Item.authorUserId);
      if (!allowed) return forbidden('Friends-only recipe');
    }

    // likedByMe — single GetItem.
    const { Item: likeRow } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPE_LIKES_TABLE_NAME,
        Key: { recipeId, userId },
      })
    );

    return ok({
      ...normalizeRecipe(Item),
      likedByMe: !!likeRow,
    });
  } catch (err) {
    console.error('recipes-get error:', err);
    return serverError(err.message);
  }
};
