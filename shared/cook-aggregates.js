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
 * Pool a list of rating-bearing rows (cooks and/or recipe-rating rows, which
 * share axis key names) into per-axis aggregates. Pure — no I/O.
 *
 * Every valid (1..5) value counts as one data point; out-of-range/missing
 * values are ignored. Returns { <avgKey>: number|null, <countKey>: number }
 * for each axis (e.g. { avgRating, ratingCount, spicinessAvg, ... }).
 */
function computeAxisAggregates(events) {
  const rows = Array.isArray(events) ? events : [];
  const out = {};
  for (const axis of COOK_AXES) {
    const vals = rows.map((e) => Number(e?.[axis.cookKey])).filter(VALID_AXIS);
    const count = vals.length;
    out[axis.avgKey] =
      count === 0
        ? null
        : Number((vals.reduce((s, v) => s + v, 0) / count).toFixed(2));
    out[axis.countKey] = count;
  }
  return out;
}

/**
 * Re-derive a recipe's rating aggregates from BOTH rating sources:
 *   1. cooks       — a per-axis rating attached to each logged cook session
 *   2. recipe-ratings — a per-user direct rating (one row per user, upserted)
 *
 * Both sources write the same aggregate columns on the recipe row
 * (avgRating/ratingCount + the four flavor axes), so this single recompute
 * is the only thing allowed to touch them. It is called after a cook is
 * logged/edited/deleted AND after a direct rating — whichever fires, the
 * card reflects every rating event, and the two paths never clobber.
 *
 * Counting rule: every rating event counts. A user who cooked a recipe
 * three times (rating each) and also left a direct rating contributes four
 * data points. We do not dedupe per user — each cook is a real, separate
 * "this is how it came out" signal, and the direct rating is a fifth
 * opinion. (recipe-ratings is already capped at one row per user.)
 *
 * `cookCount` tracks cooks only (not ratings) and is recomputed here too,
 * keeping it accurate after a delete.
 *
 * Returns the freshly computed aggregates so callers can build a response
 * without a follow-up read: { cookCount, <avgKey>, <countKey>, ... }.
 */
async function recomputeRecipeAggregates(recipeId) {
  const [cooksRes, ratingsRes] = await Promise.all([
    docClient.send(
      new QueryCommand({
        TableName: process.env.COOKS_TABLE_NAME,
        IndexName: 'recipe-index',
        KeyConditionExpression: 'recipeId = :rid',
        ExpressionAttributeValues: { ':rid': recipeId },
      })
    ),
    docClient.send(
      new QueryCommand({
        TableName: process.env.RECIPE_RATINGS_TABLE_NAME,
        KeyConditionExpression: 'recipeId = :rid',
        ExpressionAttributeValues: { ':rid': recipeId },
      })
    ),
  ]);

  const cooks = cooksRes.Items || [];
  // Both cook rows and recipe-rating rows store axis values under the same
  // keys (rating/spiciness/...), so they pool directly.
  const events = [...cooks, ...(ratingsRes.Items || [])];

  const aggregates = computeAxisAggregates(events);
  const result = { cookCount: cooks.length, ...aggregates };

  const setExprs = ['#updatedAt = :now', '#cookCount = :cnt'];
  const exprNames = { '#updatedAt': 'updatedAt', '#cookCount': 'cookCount' };
  const exprValues = {
    ':now': new Date().toISOString(),
    ':cnt': cooks.length,
  };

  for (const axis of COOK_AXES) {
    setExprs.push(`#${axis.avgKey} = :${axis.avgKey}`);
    setExprs.push(`#${axis.countKey} = :${axis.countKey}`);
    exprNames[`#${axis.avgKey}`] = axis.avgKey;
    exprNames[`#${axis.countKey}`] = axis.countKey;
    exprValues[`:${axis.avgKey}`] = aggregates[axis.avgKey];
    exprValues[`:${axis.countKey}`] = aggregates[axis.countKey];
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

  return result;
}

// Back-compat alias — the cook handlers historically imported this name.
const recomputeRecipeAggregatesFromCooks = recomputeRecipeAggregates;

module.exports = {
  COOK_AXES,
  readAxesFromBody,
  computeAxisAggregates,
  recomputeRecipeAggregates,
  recomputeRecipeAggregatesFromCooks,
};
