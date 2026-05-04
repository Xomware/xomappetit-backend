'use strict';

const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  ok,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');

// chefs/diners are intentionally NOT editable — changing them would orphan
// or duplicate rows in cook-participants. Delete + re-log instead.
const EDITABLE_FIELDS = new Set([
  'cookedAt',
  'notes',
  'photoUrl',
  'rating',
]);

/**
 * Edit a cook session. Only chefs (anyone in cook.chefs) can edit.
 *
 * Note: changing `cookedAt` would invalidate the cook-participants SK
 * (`cookedAt#cookId`), so we reject it for now. Surface the constraint
 * explicitly rather than silently dropping the field.
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
      return forbidden('Only a chef on this cook can edit it');
    }

    if (body.cookedAt && body.cookedAt !== cook.cookedAt) {
      return badRequest('cookedAt is immutable (delete + re-log to change)');
    }

    const updates = {};
    for (const key of Object.keys(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (key === 'rating') {
        if (body.rating === null) {
          updates.rating = null;
        } else if (Number.isFinite(body.rating) && body.rating >= 1 && body.rating <= 5) {
          updates.rating = body.rating;
        } else {
          return badRequest('rating must be null or a number between 1 and 5');
        }
      } else {
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return badRequest('No editable fields provided');
    }

    updates.updatedAt = new Date().toISOString();

    const setExpressions = [];
    const exprNames = {};
    const exprValues = {};
    for (const [k, v] of Object.entries(updates)) {
      setExpressions.push(`#${k} = :${k}`);
      exprNames[`#${k}`] = k;
      exprValues[`:${k}`] = v;
    }

    const { Attributes } = await docClient.send(
      new UpdateCommand({
        TableName: process.env.COOKS_TABLE_NAME,
        Key: { cookId },
        UpdateExpression: `SET ${setExpressions.join(', ')}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return ok(Attributes);
  } catch (err) {
    console.error('cooks-edit error:', err);
    return serverError(err.message);
  }
};
