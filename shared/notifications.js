'use strict';

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('./dynamo');

const RETENTION_DAYS = Number(process.env.NOTIFICATIONS_RETENTION_DAYS || 90);

/**
 * Best-effort notification write. Failures are logged but never thrown
 * — a notification dropped should never block the primary action that
 * triggered it (friend request, like, comment, etc.).
 *
 * Args:
 *   userId      recipient (the person whose inbox this lands in)
 *   type        'friend_request' | 'friend_accept' | 'recipe_liked' | 'comment_added'
 *   actorUserId who did the thing (frontend resolves to handle/avatar via batch-get)
 *   refType     'recipe' | 'cook' | 'friend' — what the notification points at
 *   refId       the recipe/cook id, or actorUserId for friend events
 *   meta        optional small object embedded for context (recipe name, etc.)
 *
 * No-ops when userId === actorUserId (don't notify yourself about your own actions).
 */
async function notify({ userId, type, actorUserId, refType, refId, meta }) {
  if (!userId || !type || userId === actorUserId) return;
  const TABLE = process.env.NOTIFICATIONS_TABLE_NAME;
  if (!TABLE) return;

  const now = new Date();
  const createdAt = now.toISOString();
  const notifId = uuidv4();
  const ttl = Math.floor(now.getTime() / 1000) + RETENTION_DAYS * 86400;

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          userId,
          sortKey: `${createdAt}#${notifId}`,
          notifId,
          type,
          actorUserId,
          refType,
          refId,
          meta: meta || null,
          read: false,
          createdAt,
          ttl,
        },
      })
    );
  } catch (err) {
    console.error('notify: write failed', err && err.name, err && err.message);
  }
}

module.exports = { notify };
