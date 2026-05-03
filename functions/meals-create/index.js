'use strict';

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { created, badRequest, serverError } = require('../../shared/response');
const { normalizeIngredients } = require('../../shared/ingredients');

exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');

    if (!body.name) return badRequest('name is required');

    const meal = {
      userId,
      mealId: uuidv4(),
      id: undefined,
      name: body.name,
      timeMinutes: body.timeMinutes || 0,
      difficulty: body.difficulty || 'Easy',
      proteinSource: body.proteinSource || '',
      ingredients: normalizeIngredients(body.ingredients),
      instructions: Array.isArray(body.instructions) ? body.instructions : [],
      macros: body.macros || { calories: 0, protein: 0, carbs: 0, fat: 0 },
      cooked: false,
      createdAt: new Date().toISOString(),
    };
    meal.id = meal.mealId;

    await docClient.send(
      new PutCommand({
        TableName: process.env.MEALS_TABLE_NAME,
        Item: meal,
      })
    );

    return created(meal);
  } catch (err) {
    console.error('meals-create error:', err);
    return serverError(err.message);
  }
};
