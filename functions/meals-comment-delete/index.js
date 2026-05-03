'use strict';

const { GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { noContent, badRequest, notFound, serverError } = require('../../shared/response');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const mealId = body.mealId;
    const commentId = body.commentId;
    if (!mealId || !commentId) return badRequest('mealId and commentId are required');

    const { Item } = await docClient.send(
      new GetCommand({
        TableName: process.env.COMMENTS_TABLE_NAME,
        Key: { mealId, commentId },
      })
    );
    if (!Item) return notFound('Comment not found');
    if (Item.userId !== userId) return notFound('Comment not found');

    await docClient.send(
      new DeleteCommand({
        TableName: process.env.COMMENTS_TABLE_NAME,
        Key: { mealId, commentId },
      })
    );

    return noContent();
  } catch (err) {
    console.error('meals-comment-delete error:', err);
    return serverError(err.message);
  }
};
