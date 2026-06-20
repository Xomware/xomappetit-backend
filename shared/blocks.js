'use strict';

const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./dynamo');

/**
 * Returns Set<string> of userIds the caller has blocked. Used by feed
 * + discover to filter out content from blocked users.
 *
 * One-direction model for v1: blocker doesn't see blockee. Blockee
 * isn't restricted from seeing blocker. Mutual invisibility is a
 * future enhancement.
 */
async function blockedIdsOf(callerId) {
  if (!callerId || !process.env.BLOCKS_TABLE_NAME) return new Set();
  const { Items = [] } = await docClient.send(
    new QueryCommand({
      TableName: process.env.BLOCKS_TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': callerId },
    })
  );
  return new Set(Items.map((r) => r.blockedUserId));
}

/**
 * True if either user has blocked the other. Used to gate direct
 * interactions (like, rate, comment, friend request) where a feed-style
 * "filter the list" approach doesn't apply — interaction across a block
 * should be refused in BOTH directions.
 */
async function blockExistsBetween(a, b) {
  if (!a || !b || a === b || !process.env.BLOCKS_TABLE_NAME) return false;
  const T = process.env.BLOCKS_TABLE_NAME;
  const [{ Item: aBlockedB }, { Item: bBlockedA }] = await Promise.all([
    docClient.send(new GetCommand({ TableName: T, Key: { userId: a, blockedUserId: b } })),
    docClient.send(new GetCommand({ TableName: T, Key: { userId: b, blockedUserId: a } })),
  ]);
  return Boolean(aBlockedB || bBlockedA);
}

module.exports = { blockedIdsOf, blockExistsBetween };
