'use strict';

const {
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
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

    // Best-effort decrement; if recipe was deleted underneath us this throws
    // and we swallow. cookCount is metadata, not a source of truth.
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: process.env.RECIPES_TABLE_NAME,
          Key: { recipeId: cook.recipeId },
          UpdateExpression: 'SET cookCount = if_not_exists(cookCount, :one) - :one, updatedAt = :now',
          ConditionExpression: 'attribute_exists(recipeId) AND cookCount > :zero',
          ExpressionAttributeValues: {
            ':one': 1,
            ':zero': 0,
            ':now': new Date().toISOString(),
          },
        })
      );
    } catch (decErr) {
      if (decErr.name !== 'ConditionalCheckFailedException') {
        console.warn('cooks-delete cookCount decrement failed:', decErr.name, decErr.message);
      }
      // Suppress — counter drift is acceptable.
    }

    return noContent();
  } catch (err) {
    console.error('cooks-delete error:', err);
    return serverError(err.message);
  }
};
