'use strict';

const { BatchGetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../shared/dynamo');
const { getUserId } = require('../../shared/auth');
const { ok, serverError } = require('../../shared/response');
const { normalizeRecipe } = require('../../shared/ingredients');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const PER_AUTHOR_RECIPES = 20;
const PER_FRIEND_COOKS = 10;

/**
 * Mixed activity feed for caller + their accepted friends, newest first.
 *
 * Two item types interleaved by activity time (createdAt for recipes,
 * cookedAt for cooks):
 *
 *   { type: 'recipe', recipe: <Recipe> }
 *   { type: 'cook',   cook:   <Cook>,   recipe: <Recipe> }
 *
 * Cook items are surfaced when the friend (or caller) was a CHEF —
 * dining at someone else's cook isn't feed-worthy. Filter by
 * cook-participants.role on the client read since the table doesn't
 * have a chef-only GSI; per-friend over-fetch (PER_FRIEND_COOKS+5)
 * keeps us from missing cooks when there are diner rows in the way.
 *
 * Privacy: recipes filtered as before. Cook items inherit privacy
 * from the parent recipe — friends recipes' cooks are visible to
 * friends only; private recipes' cooks are caller-only.
 *
 * Body: { limit?: number 1..100, default 50 }
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // 1. Friends.
    const { Items: friendRows = [] } = await docClient.send(
      new QueryCommand({
        TableName: process.env.FRIENDSHIPS_TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        FilterExpression: '#st = :ok',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':uid': userId, ':ok': 'accepted' },
      })
    );
    const friendIds = friendRows.map((r) => r.friendUserId);
    const authorIds = [userId, ...friendIds];

    // 2. In parallel: recipes by each author + cook-participants for each user.
    const recipeQueries = authorIds.map((aid) =>
      docClient.send(
        new QueryCommand({
          TableName: process.env.RECIPES_TABLE_NAME,
          IndexName: 'author-index',
          KeyConditionExpression: 'authorUserId = :uid',
          ExpressionAttributeValues: { ':uid': aid },
          ScanIndexForward: false,
          Limit: PER_AUTHOR_RECIPES,
        })
      )
    );
    const cookPartQueries = authorIds.map((aid) =>
      docClient.send(
        new QueryCommand({
          TableName: process.env.COOK_PARTICIPANTS_TABLE_NAME,
          KeyConditionExpression: 'userId = :uid',
          // Only chef rows make the feed; the over-fetch covers diner noise.
          FilterExpression: '#role = :chef',
          ExpressionAttributeNames: { '#role': 'role' },
          ExpressionAttributeValues: { ':uid': aid, ':chef': 'chef' },
          ScanIndexForward: false,
          Limit: PER_FRIEND_COOKS + 5,
        })
      )
    );

    const [recipeResults, cookPartResults] = await Promise.all([
      Promise.all(recipeQueries),
      Promise.all(cookPartQueries),
    ]);

    // 3a. Recipes — privacy filter on non-self.
    /** @type {Map<string, any>} */
    const recipesById = new Map();
    /** @type {{ type: 'recipe', recipe: any, sortAt: string }[]} */
    const recipeItems = [];
    recipeResults.forEach((res, i) => {
      const aid = authorIds[i];
      const isSelf = aid === userId;
      for (const r of res.Items || []) {
        if (!isSelf && r.privacy === 'private') continue;
        recipesById.set(r.recipeId, r);
        recipeItems.push({ type: 'recipe', recipe: r, sortAt: r.createdAt || '' });
      }
    });

    // 3b. Cook participants -> hydrate cook rows + recipe rows.
    /** @type {{ aid: string, cookId: string }[]} */
    const cookRefs = [];
    cookPartResults.forEach((res, i) => {
      const aid = authorIds[i];
      const chefRows = (res.Items || []).slice(0, PER_FRIEND_COOKS);
      for (const p of chefRows) {
        if (p.cookId) cookRefs.push({ aid, cookId: p.cookId });
      }
    });

    /** @type {{ type: 'cook', cook: any, recipe: any, sortAt: string }[]} */
    const cookItems = [];
    if (cookRefs.length > 0) {
      // BatchGet cook rows.
      const uniqCookIds = [...new Set(cookRefs.map((r) => r.cookId))];
      const cookBatches = chunk(uniqCookIds, 100);
      const cookRows = [];
      for (const batch of cookBatches) {
        const res = await docClient.send(
          new BatchGetCommand({
            RequestItems: {
              [process.env.COOKS_TABLE_NAME]: {
                Keys: batch.map((cookId) => ({ cookId })),
              },
            },
          })
        );
        cookRows.push(...(res.Responses?.[process.env.COOKS_TABLE_NAME] || []));
      }
      const cooksById = new Map(cookRows.map((c) => [c.cookId, c]));

      // Make sure we have the parent recipe row for each cook (privacy + name).
      const missingRecipeIds = [
        ...new Set(
          cookRows
            .map((c) => c.recipeId)
            .filter((rid) => rid && !recipesById.has(rid))
        ),
      ];
      if (missingRecipeIds.length > 0) {
        const recipeBatches = chunk(missingRecipeIds, 100);
        for (const batch of recipeBatches) {
          const res = await docClient.send(
            new BatchGetCommand({
              RequestItems: {
                [process.env.RECIPES_TABLE_NAME]: {
                  Keys: batch.map((recipeId) => ({ recipeId })),
                },
              },
            })
          );
          for (const r of res.Responses?.[process.env.RECIPES_TABLE_NAME] || []) {
            recipesById.set(r.recipeId, r);
          }
        }
      }

      // Build cook items, filtering private/friends-only recipes the caller
      // shouldn't see (mirrors the recipe-side privacy gate).
      for (const c of cookRows) {
        const r = recipesById.get(c.recipeId);
        if (!r) continue;
        const isSelf = r.authorUserId === userId;
        // Recipe is private -> only author sees cook activity.
        if (r.privacy === 'private' && !isSelf) continue;
        // Recipe is friends-only -> only author + friends. Friends are
        // already in authorIds, so the cook's chef being in authorIds
        // implies friend OR self. Leaving the explicit check below in
        // case future cook authors aren't in the friends set.
        if (r.privacy === 'friends' && !isSelf && !friendIds.includes(r.authorUserId)) {
          continue;
        }
        cookItems.push({ type: 'cook', cook: c, recipe: r, sortAt: c.cookedAt || c.createdAt || '' });
      }
    }

    // 4. Merge + sort by activity time, newest first.
    const merged = [...recipeItems, ...cookItems];
    merged.sort((a, b) => (b.sortAt || '').localeCompare(a.sortAt || ''));
    const trimmed = merged.slice(0, limit).map(({ type, recipe, cook }) => {
      if (type === 'cook') {
        return { type, cook, recipe: normalizeRecipe(recipe) };
      }
      return { type, recipe: normalizeRecipe(recipe) };
    });

    return ok({
      items: trimmed,
      friendCount: friendIds.length,
    });
  } catch (err) {
    console.error('friends-feed error:', err);
    return serverError(err.message);
  }
};

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
