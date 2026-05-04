'use strict';

const { DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
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
 * Delete a comment. Allowed for the comment author OR the recipe author
 * (recipe author has moderation rights on their own recipe).
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.recipeId;
    const commentId = body.commentId || body.id;

    if (!recipeId) return badRequest('recipeId is required');
    if (!commentId) return badRequest('commentId is required');

    const { Item: comment } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPE_COMMENTS_TABLE_NAME,
        Key: { recipeId, commentId },
      })
    );
    if (!comment) return notFound('Comment not found');

    if (comment.userId !== userId) {
      const { Item: recipe } = await docClient.send(
        new GetCommand({
          TableName: process.env.RECIPES_TABLE_NAME,
          Key: { recipeId },
        })
      );
      if (!recipe || recipe.authorUserId !== userId) {
        return forbidden('Only the comment author or recipe author can delete this comment');
      }
    }

    await docClient.send(
      new DeleteCommand({
        TableName: process.env.RECIPE_COMMENTS_TABLE_NAME,
        Key: { recipeId, commentId },
      })
    );

    return noContent();
  } catch (err) {
    console.error('recipes-comment-delete error:', err);
    return serverError(err.message);
  }
};
