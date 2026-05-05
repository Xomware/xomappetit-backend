'use strict';

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, badRequest, serverError } = require('../../shared/response');

const VALID_REF = new Set(['user', 'recipe', 'cook', 'comment']);
const RETENTION_DAYS = 90;
const MAX_REASON = 500;

/**
 * Report content. Write-only — admin moderation UI is a future feature.
 *
 * Body: { refType: 'user'|'recipe'|'cook'|'comment', refId: string,
 *         reason?: string }
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const { refType, refId, reason } = body;

    if (!VALID_REF.has(refType)) {
      return badRequest("refType must be 'user', 'recipe', 'cook', or 'comment'");
    }
    if (!refId || typeof refId !== 'string') {
      return badRequest('refId is required');
    }
    const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON) : '';

    const now = new Date();
    const reportId = uuidv4();
    const createdAt = now.toISOString();
    const ttl = Math.floor(now.getTime() / 1000) + RETENTION_DAYS * 86400;

    await docClient.send(
      new PutCommand({
        TableName: process.env.REPORTS_TABLE_NAME,
        Item: {
          userId,
          sortKey: `${createdAt}#${reportId}`,
          reportId,
          refType,
          refId,
          reason: trimmedReason,
          createdAt,
          ttl,
        },
      })
    );

    return ok({ status: 'received' });
  } catch (err) {
    console.error('reports-add error:', err);
    return serverError(err.message);
  }
};
