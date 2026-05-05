'use strict';

const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./dynamo');

/**
 * Rating axes the cook row carries. Adding a new axis is one entry here
 * (and one in the frontend RATING_AXES table).
 *
 * Naming note: 'rating' is the legacy column for the overall axis, kept
 * for back-compat with RecipeCard which reads avgRating/ratingCount.
 */
const COOK_AXES = [
  { cookKey: 'rating',    avgKey: 'avgRating',     countKey: 'ratingCount' },
  { cookKey: 'spiciness', avgKey: 'spicinessAvg',  countKey: 'spicinessCount' },
  { cookKey: 'sweetness', avgKey: 'sweetnessAvg',  countKey: 'sweetnessCount' },
  { cookKey: 'saltiness', avgKey: 'saltinessAvg',  countKey: 'saltinessCount' },
  { cookKey: 'richness',  avgKey: 'richnessAvg',   countKey: 'richnessCount' },
];

const VALID_AXIS = (n) => Number.isFinite(n) && n >= 1 && n <= 5;

/**
 * Pull (and validate) every rating axis from a request body. Returns an
 * { axisKey: number|null } map. Throws on out-of-range values.
 */
function readAxesFromBody(body) {
  const out = {};
  for (const axis of COOK_AXES) {
    const raw = body?.[axis.cookKey];
    if (raw === undefined) continue;
    if (raw === null) {
      out[axis.cookKey] = null;
      continue;
    }
    const n = Number(raw);
    if (!VALID_AXIS(n)) {
      throw new Error(`${axis.cookKey} must be a number between 1 and 5`);
    }
    out[axis.cookKey] = n;
  }
  return out;
}

/**
 * Re-derive the recipe row's rating aggregates from every cook of that
 * recipe. Called after a cook is logged / edited / deleted so the recipe
 * card always reflects the truth of "what people who actually cooked it
 * thought".
 *
 * Also bumps cookCount based on actual row count — keeps it accurate
 * after a delete since cooks-log was incrementing optimistically.
 */
async function recomputeRecipeAggregatesFromCooks(recipeId) {
  const { Items: cooks = [] } = await docClient.send(
    new QueryCommand({
      TableName: process.env.COOKS_TABLE_NAME,
      IndexName: 'recipe-index',
      KeyConditionExpression: 'recipeId = :rid',
      ExpressionAttributeValues: { ':rid': recipeId },
    })
  );

  const setExprs = ['#updatedAt = :now', '#cookCount = :cnt'];
  const exprNames = { '#updatedAt': 'updatedAt', '#cookCount': 'cookCount' };
  const exprValues = {
    ':now': new Date().toISOString(),
    ':cnt': cooks.length,
  };

  for (const axis of COOK_AXES) {
    const vals = cooks
      .map((c) => Number(c[axis.cookKey]))
      .filter((v) => Number.isFinite(v) && v >= 1 && v <= 5);
    const count = vals.length;
    const avg =
      count === 0
        ? null
        : Number((vals.reduce((s, v) => s + v, 0) / count).toFixed(2));

    setExprs.push(`#${axis.avgKey} = :${axis.avgKey}`);
    setExprs.push(`#${axis.countKey} = :${axis.countKey}`);
    exprNames[`#${axis.avgKey}`] = axis.avgKey;
    exprNames[`#${axis.countKey}`] = axis.countKey;
    exprValues[`:${axis.avgKey}`] = avg;
    exprValues[`:${axis.countKey}`] = count;
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
}

module.exports = { COOK_AXES, readAxesFromBody, recomputeRecipeAggregatesFromCooks };
