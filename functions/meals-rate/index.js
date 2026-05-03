'use strict';

const { PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, badRequest, notFound, serverError } = require('../../shared/response');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const mealId = body.id || body.mealId;
    if (!mealId) return badRequest('id is required');

    const { taste, ease, speed, healthiness, notes } = body;
    if (taste == null || ease == null || speed == null || healthiness == null) {
      return badRequest('taste, ease, speed, and healthiness are required');
    }

    const rating = {
      taste: Number(taste),
      ease: Number(ease),
      speed: Number(speed),
      healthiness: Number(healthiness),
      notes: notes || '',
    };

    // Save to ratings table
    await docClient.send(
      new PutCommand({
        TableName: process.env.RATINGS_TABLE_NAME,
        Item: { userId, mealId, ...rating, ratedAt: new Date().toISOString() },
      })
    );

    // Update meal with embedded rating
    const { Attributes } = await docClient.send(
      new UpdateCommand({
        TableName: process.env.MEALS_TABLE_NAME,
        Key: { userId, mealId },
        UpdateExpression: 'SET rating = :rating',
        ExpressionAttributeValues: { ':rating': rating },
        ConditionExpression: 'attribute_exists(userId)',
        ReturnValues: 'ALL_NEW',
      })
    );

    if (!Attributes) return notFound('Meal not found');
    return ok(Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return notFound('Meal not found');
    console.error('meals-rate error:', err);
    return serverError(err.message);
  }
};
