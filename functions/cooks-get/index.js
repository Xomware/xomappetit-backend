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

/**
 * Get a single cook session. Visibility model: anyone listed in chefs/diners
 * can see, plus the recipe author. For non-private recipes, anyone
 * authenticated can view (matches how recipe pages aggregate cook counts).
 *
 * Friends-only recipes are visible to the author, participants, and the
 * author's accepted friends.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const cookId = body.id || body.cookId;
    if (!cookId) return badRequest('cookId is required');

    const { Item: cook } = await docClient.send(
      new GetCommand({
        TableName: process.env.COOKS_TABLE_NAME,
        Key: { cookId },
      })
    );
    if (!cook) return notFound('Cook not found');

    const { Item: recipe } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId: cook.recipeId },
      })
    );

    const isParticipant =
      (cook.chefs || []).includes(userId) || (cook.diners || []).includes(userId);

    // Recipe gone (deletes don't cascade to cooks). Don't fall back to
    // "public" — that would expose a deleted private recipe's cook to anyone.
    // Participants keep access to their own cook history; everyone else gets 404.
    if (!recipe) {
      return isParticipant ? ok(cook) : notFound('Recipe not found');
    }

    const isRecipeAuthor = recipe.authorUserId === userId;
    const recipePrivacy = recipe.privacy || 'public';

    if (recipePrivacy === 'private' && !isParticipant && !isRecipeAuthor) {
      return forbidden('Cook on a private recipe');
    }
    if (recipePrivacy === 'friends' && !isParticipant && !isRecipeAuthor) {
      const friends = await isFriend(userId, recipe.authorUserId);
      if (!friends) return forbidden('Cook on a friends-only recipe');
    }

    return ok(cook);
  } catch (err) {
    console.error('cooks-get error:', err);
    return serverError(err.message);
  }
};
