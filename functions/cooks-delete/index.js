'use strict';

const {
  GetCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  noContent,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');
const { recomputeRecipeAggregatesFromCooks } = require('../../shared/cook-aggregates');

/**
 * Delete a cook session. Chef-only. Cleans up:
 *   - the cooks row
 *   - every cook-participants row for this cook (chef + diner)
 *   - decrements recipe.cookCount (best-effort, post-transaction)
 *
 * Participant SK is deterministic (`cookedAt#cookId`), so we don't need a
 * GSI to find the rows.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const cookId = body.id || body.cookId;
    if (!cookId) return badRequest('cookId is required');

    const { Item: cook } = await docClient.send(
      new GetCommand({
        TableName: process.env.COOKS_TABLE_NAME,
        Key: { cookId },
      })
    );
    if (!cook) return notFound('Cook not found');
    if (!(cook.chefs || []).includes(userId)) {
      return forbidden('Only a chef on this cook can delete it');
    }

    const sortKey = `${cook.cookedAt}#${cookId}`;
    const participantIds = [...new Set([...(cook.chefs || []), ...(cook.diners || [])])];

    const transactItems = [
      {
        Delete: {
          TableName: process.env.COOKS_TABLE_NAME,
          Key: { cookId },
        },
      },
      ...participantIds.map((uid) => ({
        Delete: {
          TableName: process.env.COOK_PARTICIPANTS_TABLE_NAME,
          Key: { userId: uid, cookedAtCookId: sortKey },
        },
      })),
    ];

    // TransactWriteCommand items cap at 100. cooks-log already enforces a
    // 25-participant cap so this is well within limits.
    await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

    // Recompute the recipe's aggregates from the remaining cooks so
    // cookCount + every rating axis stay in sync. Best-effort.
    try {
      await recomputeRecipeAggregatesFromCooks(cook.recipeId);
    } catch (err) {
      console.warn('cooks-delete: aggregate recompute failed:', err.name, err.message);
    }

    return noContent();
  } catch (err) {
    console.error('cooks-delete error:', err);
    return serverError(err.message);
  }
};
