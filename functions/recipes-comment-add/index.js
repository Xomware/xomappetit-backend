'use strict';

const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { notify } = require('../../shared/notifications');
const {
  created,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');

const MAX_COMMENT_LENGTH = 2000;

/**
 * Add a comment to a recipe. Privacy mirrors recipes-get: public allows any
 * authenticated commenter, private is author-only, friends is author-only
 * until the friends feature ships.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.id || body.recipeId;
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (!recipeId) return badRequest('recipeId is required');
    if (!text) return badRequest('text is required');
    if (text.length > MAX_COMMENT_LENGTH) {
      return badRequest(`text exceeds ${MAX_COMMENT_LENGTH} characters`);
    }

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
      return forbidden('Friends-only recipe (privacy stub: real check pending friends feature)');
    }

    const comment = {
      recipeId,
      commentId: uuidv4(),
      userId,
      text,
      createdAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.RECIPE_COMMENTS_TABLE_NAME,
        Item: comment,
      })
    );

    await notify({
      userId: recipe.authorUserId,
      type: 'comment_added',
      actorUserId: userId,
      refType: 'recipe',
      refId: recipeId,
      meta: { recipeName: recipe.name },
    });

    return created(comment);
  } catch (err) {
    console.error('recipes-comment-add error:', err);
    return serverError(err.message);
  }
};
