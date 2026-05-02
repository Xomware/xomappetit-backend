'use strict';

const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { created, badRequest, notFound, serverError } = require('../../shared/response');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const mealId = event.pathParameters?.id;
    const body = JSON.parse(event.body || '{}');

    const text = String(body.body || '').trim();
    if (!text) return badRequest('body is required');
    if (text.length > 2000) return badRequest('body too long (max 2000 chars)');

    const { Item: meal } = await docClient.send(
      new GetCommand({
        TableName: process.env.MEALS_TABLE_NAME,
        Key: { userId, mealId },
      })
    );
    if (!meal) return notFound('Meal not found');

    const comment = {
      mealId,
      commentId: uuidv4(),
      userId,
      body: text,
      createdAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.COMMENTS_TABLE_NAME,
        Item: comment,
      })
    );

    return created(comment);
  } catch (err) {
    console.error('meals-comment-add error:', err);
    return serverError(err.message);
  }
};
