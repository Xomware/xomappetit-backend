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
 * Delete a cook comment. Author of the COMMENT can always delete their
 * own. The cook's chef list also has moderation rights on their cook.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const cookId = body.cookId;
    const commentId = body.commentId || body.id;
    if (!cookId) return badRequest('cookId is required');
    if (!commentId) return badRequest('commentId is required');

    const { Item: comment } = await docClient.send(
      new GetCommand({
        TableName: process.env.COOK_COMMENTS_TABLE_NAME,
        Key: { cookId, commentId },
      })
    );
    if (!comment) return notFound('Comment not found');

    if (comment.userId !== userId) {
      const { Item: cook } = await docClient.send(
        new GetCommand({
          TableName: process.env.COOKS_TABLE_NAME,
          Key: { cookId },
        })
      );
      const isChef = cook && Array.isArray(cook.chefs) && cook.chefs.includes(userId);
      if (!isChef) {
        return forbidden('Only the comment author or the cook chef can delete this comment');
      }
    }

    await docClient.send(
      new DeleteCommand({
        TableName: process.env.COOK_COMMENTS_TABLE_NAME,
        Key: { cookId, commentId },
      })
    );

    return noContent();
  } catch (err) {
    console.error('cooks-comment-delete error:', err);
    return serverError(err.message);
  }
};
