'use strict';

const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const {
  ok,
  badRequest,
  forbidden,
  notFound,
  serverError,
} = require('../../shared/response');
const { normalizeRecipe } = require('../../shared/ingredients');

/**
 * Get a single recipe with v1 privacy enforcement:
 *
 *   - public:  any authenticated caller
 *   - private: author only
 *   - friends: TODO (no friends table yet) — stub treats non-author as 403.
 *              Real check ships post-friends-feature.
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const recipeId = body.id || body.recipeId;
    if (!recipeId) return badRequest('id is required');

    const { Item } = await docClient.send(
      new GetCommand({
        TableName: process.env.RECIPES_TABLE_NAME,
        Key: { recipeId },
      })
    );

    if (!Item) return notFound('Recipe not found');

    const isAuthor = Item.authorUserId === userId;
    if (Item.privacy === 'private' && !isAuthor) {
      return forbidden('Recipe is private');
    }
    // TODO(post-friends): replace this stub with a real friendship check
    // (xomware-users/friends table). For v1 we treat all non-author requests
    // on `friends`-privacy recipes as forbidden so the surface is locked-down
    // by default.
    if (Item.privacy === 'friends' && !isAuthor) {
      return forbidden('Friends-only recipe (privacy stub: real check pending friends feature)');
    }

    return ok(normalizeRecipe(Item));
  } catch (err) {
    console.error('recipes-get error:', err);
    return serverError(err.message);
  }
};
