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
 * Configurable rating axes. Adding a new axis is one entry here:
 *   - bodyKey: what the API caller sends (e.g. 'sweetness')
 *   - rowKey: column on the recipe-rating row (kept identical to bodyKey)
 *   - recipeAvgKey/recipeCountKey: where to write the aggregates on the recipe row
 *
 * The 'rating'/'avgRating'/'ratingCount' triplet is legacy naming for the
 * 'overall' axis — kept verbatim for back-compat with existing rows + the
 * frontend's RecipeCard which reads avgRating/ratingCount directly.
 */
const AXES = [
  { bodyKey: 'rating',    rowKey: 'rating',    recipeAvgKey: 'avgRating',     recipeCountKey: 'ratingCount' },
  { bodyKey: 'spiciness', rowKey: 'spiciness', recipeAvgKey: 'spicinessAvg',  recipeCountKey: 'spicinessCount' },
  { bodyKey: 'sweetness', rowKey: 'sweetness', recipeAvgKey: 'sweetnessAvg',  recipeCountKey: 'sweetnessCount' },
  { bodyKey: 'saltiness', rowKey: 'saltiness', recipeAvgKey: 'saltinessAvg',  recipeCountKey: 'saltinessCount' },
  { bodyKey: 'richness',  rowKey: 'richness',  recipeAvgKey: 'richnessAvg',   recipeCountKey: 'richnessCount' },
];

function validAxis(n) {
  return Number.isFinite(n) && n >= 1 && n <= 5;
}

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.id || body.recipeId;
    if (!recipeId) return badRequest('recipeId is required');

    // Pull every axis the caller sent, validate, default null otherwise.
    const incoming = {};
    let anyProvided = false;
    for (const axis of AXES) {
      const raw = body[axis.bodyKey];
      if (raw === null || raw === undefined) {
        incoming[axis.rowKey] = null;
        continue;
      }
      const n = Number(raw);
      if (!validAxis(n)) {
        return badRequest(`${axis.bodyKey} must be a number between 1 and 5`);
      }
      incoming[axis.rowKey] = n;
      anyProvided = true;
    }
    if (!anyProvided) {
      const list = AXES.map((a) => a.bodyKey).join(' / ');
      return badRequest(`Provide at least one axis: ${list} (1..5)`);
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

    // Read existing rating row so axes the caller skipped this round are preserved.
    const { Item: existing } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPE_RATINGS_TABLE_NAME,
        Key: { recipeId, userId },
      })
    );

    const item = { recipeId, userId, updatedAt: now };
    for (const axis of AXES) {
      item[axis.rowKey] =
        incoming[axis.rowKey] !== null
          ? incoming[axis.rowKey]
          : existing?.[axis.rowKey] ?? null;
    }

    await docClient.send(
      new PutCommand({
        TableName: process.env.RECIPE_RATINGS_TABLE_NAME,
        Item: item,
      })
    );

    // Recompute aggregates for every axis from the partition.
    const { Items: ratings = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.RECIPE_RATINGS_TABLE_NAME,
        KeyConditionExpression: 'recipeId = :rid',
        ExpressionAttributeValues: { ':rid': recipeId },
      })
    );

    const setExprs = ['updatedAt = :now'];
    const exprValues = { ':now': now };
    const exprNames = {};
    const summary = { recipeId, userId };

    for (const axis of AXES) {
      const vals = ratings.map((r) => Number(r[axis.rowKey])).filter(Number.isFinite);
      const count = vals.length;
      const avg =
        count === 0
          ? null
          : Number((vals.reduce((s, v) => s + v, 0) / count).toFixed(2));
      const avgPlaceholder = `:${axis.recipeAvgKey}`;
      const cntPlaceholder = `:${axis.recipeCountKey}`;
      setExprs.push(`#${axis.recipeAvgKey} = ${avgPlaceholder}`);
      setExprs.push(`#${axis.recipeCountKey} = ${cntPlaceholder}`);
      exprNames[`#${axis.recipeAvgKey}`] = axis.recipeAvgKey;
      exprNames[`#${axis.recipeCountKey}`] = axis.recipeCountKey;
      exprValues[avgPlaceholder] = avg;
      exprValues[cntPlaceholder] = count;
      summary[axis.recipeAvgKey] = avg;
      summary[axis.recipeCountKey] = count;
      summary[axis.bodyKey] = item[axis.rowKey];
    }

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
        UpdateExpression: `SET ${setExprs.join(', ')}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
      })
    );

    return ok(summary);
  } catch (err) {
    console.error('recipes-rate error:', err);
    return serverError(err.message);
  }
};
