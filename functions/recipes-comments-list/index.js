'use strict';

const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
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
 * List all comments on a recipe, oldest first. Privacy mirrors recipes-get.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.id || body.recipeId;
    if (!recipeId) return badRequest('recipeId is required');

    const { Item: recipe } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
      })
    );
    if (!recipe) return notFound('Recipe not found');

    const isAuthor = recipe.authorUserId === userId;
    if (recipe.privacy === 'private' && !isAuthor) return forbidden('Recipe is private');
    if (recipe.privacy === 'friends' && !isAuthor) {
      const friends = await isFriend(userId, recipe.authorUserId);
      if (!friends) return forbidden('Friends-only recipe');
    }

    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.RECIPE_COMMENTS_TABLE_NAME,
        KeyConditionExpression: 'recipeId = :rid',
        ExpressionAttributeValues: { ':rid': recipeId },
      })
    );

    // recipe-comments SK is commentId (uuid) which doesn't sort by time —
    // sort by createdAt in the handler.
    Items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    return ok(Items);
  } catch (err) {
    console.error('recipes-comments-list error:', err);
    return serverError(err.message);
  }
};
