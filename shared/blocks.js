'use strict';

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
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

module.exports = { blockedIdsOf };
