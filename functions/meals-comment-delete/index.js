'use strict';

const { GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { noContent, notFound, serverError } = require('../../shared/response');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const mealId = event.pathParameters?.id;
    const commentId = event.pathParameters?.commentId;

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
