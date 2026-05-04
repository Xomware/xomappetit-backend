'use strict';

const {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  ok,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');

/**
 * Upsert a rating for a recipe and recompute avgRating + ratingCount on the
 * recipe row.
 *
 * recipe-ratings PK=recipeId, SK=userId — one row per (caller, recipe).
 * After writing, we re-query the partition and recompute. Hobby scale: a
 * full partition scan per rate is fine; revisit when a recipe routinely
 * crosses ~10k ratings.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.id || body.recipeId;
    const rating = Number(body.rating);

    if (!recipeId) return badRequest('recipeId is required');
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return badRequest('rating must be a number between 1 and 5');
    }

    // Privacy gate — same rules as recipes-get.
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

    const now = new Date().toISOString();
    await docClient.send(
      new PutCommand({
        TableName: process.env.RECIPE_RATINGS_TABLE_NAME,
        Item: { recipeId, userId, rating, updatedAt: now },
      })
    );

    const { Items: ratings = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.RECIPE_RATINGS_TABLE_NAME,
        KeyConditionExpression: 'recipeId = :rid',
        ExpressionAttributeValues: { ':rid': recipeId },
      })
    );

    const ratingCount = ratings.length;
    const avgRating = ratingCount === 0
      ? null
      : Number((ratings.reduce((s, r) => s + Number(r.rating || 0), 0) / ratingCount).toFixed(2));

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
        UpdateExpression: 'SET avgRating = :avg, ratingCount = :cnt, updatedAt = :now',
        ExpressionAttributeValues: {
          ':avg': avgRating,
          ':cnt': ratingCount,
          ':now': now,
        },
      })
    );

    return ok({ recipeId, userId, rating, avgRating, ratingCount });
  } catch (err) {
    console.error('recipes-rate error:', err);
    return serverError(err.message);
  }
};
