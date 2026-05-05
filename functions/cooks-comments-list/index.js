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
 * List comments on a cook session, oldest first. Privacy mirrors the
 * parent recipe (same gate as cooks-comment-add).
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const cookId = body.cookId || body.id;
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
    const recipePrivacy = recipe?.privacy || 'public';
    const isAuthor = recipe?.authorUserId === userId;

    if (recipePrivacy === 'private' && !isAuthor) {
      return forbidden('Cook on a private recipe');
    }
    if (recipePrivacy === 'friends' && !isAuthor) {
      const allowed = await isFriend(userId, recipe.authorUserId);
      if (!allowed) return forbidden('Cook on a friends-only recipe');
    }

    const { Items = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.COOK_COMMENTS_TABLE_NAME,
        KeyConditionExpression: 'cookId = :cid',
        ExpressionAttributeValues: { ':cid': cookId },
      })
    );
    Items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    return ok(Items);
  } catch (err) {
    console.error('cooks-comments-list error:', err);
    return serverError(err.message);
  }
};
