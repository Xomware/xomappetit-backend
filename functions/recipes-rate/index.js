'use strict';

const {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { isFriendsWith } = require('../../shared/friendships');
const {
  ok,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');

/**
 * Upsert a rating row for (caller, recipe) and recompute aggregates on the
 * recipe row.
 *
 * Multi-axis: body may include `rating` (overall, 1..5) and/or `spiciness`
 * (1..5). At least one axis must be provided. Each axis recomputes its own
 * avg/count from the partition.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.id || body.recipeId;

    if (!recipeId) return badRequest('recipeId is required');

    const overall = body.rating === null || body.rating === undefined
      ? null
      : Number(body.rating);
    const spiciness = body.spiciness === null || body.spiciness === undefined
      ? null
      : Number(body.spiciness);

    const validAxis = (n) => Number.isFinite(n) && n >= 1 && n <= 5;
    if (overall === null && spiciness === null) {
      return badRequest('Provide rating and/or spiciness (1..5)');
    }
    if (overall !== null && !validAxis(overall)) {
      return badRequest('rating must be a number between 1 and 5');
    }
    if (spiciness !== null && !validAxis(spiciness)) {
      return badRequest('spiciness must be a number between 1 and 5');
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
      const friends = await isFriendsWith(userId, recipe.authorUserId).catch(() => false);
      if (!friends) return forbidden('Friends-only recipe');
    }

    const now = new Date().toISOString();

    // Read existing row to preserve axes the caller didn't include this time.
    const { Item: existing } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPE_RATINGS_TABLE_NAME,
        Key: { recipeId, userId },
      })
    );

    const item = {
      recipeId,
      userId,
      rating: overall !== null ? overall : (existing?.rating ?? null),
      spiciness: spiciness !== null ? spiciness : (existing?.spiciness ?? null),
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.RECIPE_RATINGS_TABLE_NAME,
        Item: item,
      })
    );

    // Recompute aggregates from the partition.
    const { Items: ratings = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.RECIPE_RATINGS_TABLE_NAME,
        KeyConditionExpression: 'recipeId = :rid',
        ExpressionAttributeValues: { ':rid': recipeId },
      })
    );

    const overallVals = ratings.map((r) => Number(r.rating)).filter(Number.isFinite);
    const spiceVals = ratings.map((r) => Number(r.spiciness)).filter(Number.isFinite);

    const avg = (xs) =>
      xs.length === 0 ? null : Number((xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(2));

    const avgRating = avg(overallVals);
    const ratingCount = overallVals.length;
    const spicinessAvg = avg(spiceVals);
    const spicinessCount = spiceVals.length;

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
        UpdateExpression:
          'SET avgRating = :avg, ratingCount = :cnt, spicinessAvg = :sAvg, spicinessCount = :sCnt, updatedAt = :now',
        ExpressionAttributeValues: {
          ':avg': avgRating,
          ':cnt': ratingCount,
          ':sAvg': spicinessAvg,
          ':sCnt': spicinessCount,
          ':now': now,
        },
      })
    );

    return ok({
      recipeId,
      userId,
      rating: item.rating,
      spiciness: item.spiciness,
      avgRating,
      ratingCount,
      spicinessAvg,
      spicinessCount,
    });
  } catch (err) {
    console.error('recipes-rate error:', err);
    return serverError(err.message);
  }
};
