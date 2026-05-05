'use strict';

const {
  GetCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  created,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');
const {
  readAxesFromBody,
  recomputeRecipeAggregatesFromCooks,
} = require('../../shared/cook-aggregates');

const MAX_PARTICIPANTS = 25; // sanity cap; transact-write supports 100 items

function uniqueIds(input, fallbackUserId) {
  const arr = Array.isArray(input) ? input : [];
  const out = new Set();
  for (const id of arr) {
    if (typeof id === 'string' && id.trim()) out.add(id.trim());
  }
  if (fallbackUserId) out.add(fallbackUserId);
  return [...out];
}

/**
 * Log a cook session: writes one `cooks` row + one `cook-participants` row
 * per chef AND per diner, then bumps `recipes.cookCount`.
 *
 * Caller is added to chefs by default (you cooked it) — pass an explicit
 * `chefs` list to override (e.g. logging on someone else's behalf).
 *
 * Privacy mirrors recipes-get: public OK, friends/private = author-only stub.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.recipeId;
    if (!recipeId) return badRequest('recipeId is required');

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

    const cookId = uuidv4();
    const cookedAt = typeof body.cookedAt === 'string' && body.cookedAt
      ? body.cookedAt
      : new Date().toISOString();
    const chefs = uniqueIds(body.chefs, userId);
    // Allow same user in both chefs and diners — 'I cooked it AND ate it'
    // is the default case. cook-participants dedupes (chef wins as the
    // canonical role for that user's cook listing).
    const diners = uniqueIds(body.diners);

    if (chefs.length + diners.length > MAX_PARTICIPANTS) {
      return badRequest(`Too many participants (max ${MAX_PARTICIPANTS})`);
    }

    let axes;
    try {
      axes = readAxesFromBody(body);
    } catch (e) {
      return badRequest(e.message);
    }

    const now = new Date().toISOString();
    const cook = {
      cookId,
      recipeId,
      cookedAt,
      chefs,
      diners,
      notes: typeof body.notes === 'string' ? body.notes : '',
      photoUrl: typeof body.photoUrl === 'string' ? body.photoUrl : '',
      rating: axes.rating ?? null,
      spiciness: axes.spiciness ?? null,
      sweetness: axes.sweetness ?? null,
      saltiness: axes.saltiness ?? null,
      richness: axes.richness ?? null,
      loggedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    };

    const sortKey = `${cookedAt}#${cookId}`;
    // Dedupe participants: one row per (user, cook). Chef wins as the
    // canonical role since SK is `cookedAt#cookId` (unique per user+cook).
    const seen = new Set();
    const participantItems = [];
    for (const uid of chefs) {
      participantItems.push({ userId: uid, cookedAtCookId: sortKey, cookId, recipeId, role: 'chef', cookedAt });
      seen.add(uid);
    }
    for (const uid of diners) {
      if (seen.has(uid)) continue;
      participantItems.push({ userId: uid, cookedAtCookId: sortKey, cookId, recipeId, role: 'diner', cookedAt });
      seen.add(uid);
    }

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: process.env.COOKS_TABLE_NAME, Item: cook } },
          ...participantItems.map((Item) => ({
            Put: { TableName: process.env.COOK_PARTICIPANTS_TABLE_NAME, Item },
          })),
        ],
      })
    );

    // Re-derive recipe rating aggregates + cookCount from every cook of
    // this recipe. Best-effort — failure shouldn't fail the user's log.
    try {
      await recomputeRecipeAggregatesFromCooks(recipeId);
    } catch (err) {
      console.error('cooks-log: aggregate recompute failed', err);
    }

    return created(cook);
  } catch (err) {
    console.error('cooks-log error:', err);
    return serverError(err.message);
  }
};
