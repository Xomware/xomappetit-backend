'use strict';

const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { isFriend } = require('../../shared/friendships');
const {
  created,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');

const MAX_COMMENT_LENGTH = 2000;

/**
 * Add a comment to a cook session. Privacy mirrors the parent recipe:
 *
 *   - public  recipe → any authenticated caller can comment
 *   - friends recipe → caller must be the author or an accepted friend
 *   - private recipe → caller must be the author
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const cookId = body.cookId || body.id;
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (!cookId) return badRequest('cookId is required');
    if (!text) return badRequest('text is required');
    if (text.length > MAX_COMMENT_LENGTH) {
      return badRequest(`text exceeds ${MAX_COMMENT_LENGTH} characters`);
    }

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
    const recipePrivacy = recipe?.privacy || 'public';
    const isAuthor = recipe?.authorUserId === userId;

    if (recipePrivacy === 'private' && !isAuthor) {
      return forbidden('Cook on a private recipe');
    }
    if (recipePrivacy === 'friends' && !isAuthor) {
      const allowed = await isFriend(userId, recipe.authorUserId);
      if (!allowed) return forbidden('Cook on a friends-only recipe');
    }

    const comment = {
      cookId,
      commentId: uuidv4(),
      userId,
      text,
      createdAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.COOK_COMMENTS_TABLE_NAME,
        Item: comment,
      })
    );

    return created(comment);
  } catch (err) {
    console.error('cooks-comment-add error:', err);
    return serverError(err.message);
  }
};
