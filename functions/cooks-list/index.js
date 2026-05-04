'use strict';

const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  ok,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');

/**
 * List cook sessions in one of two scopes:
 *
 *   - scope='mine'   → query cook-participants by caller userId
 *                      (returns every cook the caller cheffed or dined)
 *   - scope='recipe' → query cooks by recipe-index GSI
 *                      (privacy-gated against the recipe row)
 *
 * Default scope is 'mine'.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const scope = body.scope === 'recipe' ? 'recipe' : 'mine';

    if (scope === 'recipe') {
      const recipeId = body.recipeId;
      if (!recipeId) return badRequest('recipeId is required for scope=recipe');

      const { Item: recipe } = await docClient.send(
        new GetCommand({
          TableName: process.env.RECIPES_TABLE_NAME,
          Key: { recipeId },
        })
      );
      if (!recipe) return notFound('Recipe not found');

      const isAuthor = recipe.authorUserId === userId;
      if (recipe.privacy === 'private' && !isAuthor) return forbidden('Recipe is private');
      if (recipe.privacy === 'friends' && !isAuthor) {
        return forbidden('Friends-only recipe (privacy stub: real check pending friends feature)');
      }

      const { Items = [] } = await docClient.send(
        new QueryCommand({
          TableName: process.env.COOKS_TABLE_NAME,
          IndexName: 'recipe-index',
          KeyConditionExpression: 'recipeId = :rid',
          ExpressionAttributeValues: { ':rid': recipeId },
          ScanIndexForward: false,
        })
      );
      return ok(Items);
    }

    // scope = 'mine' — fan-out via cook-participants then hydrate
    const { Items: parts = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.COOK_PARTICIPANTS_TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: { ':uid': userId },
        ScanIndexForward: false,
      })
    );

    if (parts.length === 0) return ok([]);

    // Hydrate via parallel GetCommands. BatchGet is cheaper but caps at 100;
    // small loop is fine for hobby scale and keeps error surfacing simple.
    const cooks = await Promise.all(
      parts.map((p) =>
        docClient
          .send(
            new GetCommand({
              TableName: process.env.COOKS_TABLE_NAME,
              Key: { cookId: p.cookId },
            })
          )
          .then((r) => (r.Item ? { ...r.Item, role: p.role } : null))
      )
    );

    return ok(cooks.filter(Boolean));
  } catch (err) {
    console.error('cooks-list error:', err);
    return serverError(err.message);
  }
};
