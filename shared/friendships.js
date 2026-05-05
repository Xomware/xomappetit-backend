'use strict';

const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./dynamo');

/**
 * One-shot friendship check used by recipes-get / recipes-list / etc.
 * Self always counts as friend (for the purpose of seeing your own
 * friends-privacy content).
 */
async function isFriend(callerId, targetId) {
  if (!callerId || !targetId) return false;
  if (callerId === targetId) return true;
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: process.env.FRIENDSHIPS_TABLE_NAME,
      Key: { userId: callerId, friendUserId: targetId },
    })
  );
  return Item?.status === 'accepted';
}

/**
 * Bulk variant — returns Set<string> of friend userIds for the caller.
 * Use when checking many recipes at once (recipes-list, recipes-list-public)
 * to avoid N round-trips.
 */
async function friendIdsOf(callerId) {
  if (!callerId) return new Set();
  const { Items = [] } = await docClient.send(
    new QueryCommand({
      TableName: process.env.FRIENDSHIPS_TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: '#st = :ok',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':uid': callerId, ':ok': 'accepted' },
    })
  );
  return new Set(Items.map((r) => r.friendUserId));
}

module.exports = { isFriend, friendIdsOf };
