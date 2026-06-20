'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractRecipeJsonLd } = require('../shared/recipe-jsonld');

// Only extractRecipeJsonLd is public; it exercises the internal amount /
// duration / instruction / ingredient parsers, so we test through it.

test('extractRecipeJsonLd: parses a full Recipe (ingredients, steps, time)', () => {
  const html = `<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Recipe","name":"Test Pancakes",
     "description":"Fluffy stack",
     "recipeYield":"4 servings",
     "recipeIngredient":["1 1/2 cups all-purpose flour","2 eggs","1/2 tsp salt"],
     "recipeInstructions":[{"@type":"HowToStep","text":"Mix"},{"@type":"HowToStep","text":"Cook"}],
     "totalTime":"PT20M"}
    </script></head><body></body></html>`;
  const draft = extractRecipeJsonLd(html);
  assert.ok(draft, 'expected a draft');
  assert.equal(draft.name, 'Test Pancakes');
  assert.equal(draft.timeMinutes, 20); // PT20M parsed
  assert.equal(draft.servings, 4); // "4 servings" parsed
  assert.ok(draft.ingredients.length >= 3);
  // "1 1/2 cups all-purpose flour" -> amount 1.5, unit cup
  const flour = draft.ingredients.find((i) => i.name.includes('flour'));
  assert.equal(flour.amount, 1.5);
  assert.equal(flour.unit, 'cup');
  assert.ok(draft.instructions.length >= 2);
  assert.equal(draft.instructions[0].text, 'Mix');
});

test('extractRecipeJsonLd: finds a Recipe nested inside an @graph', () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"Some Blog"},
      {"@type":"Recipe","name":"Graph Soup","recipeIngredient":["1 cup lentil"]}
    ]}</script>`;
  const draft = extractRecipeJsonLd(html);
  assert.ok(draft);
  assert.equal(draft.name, 'Graph Soup');
});

test('extractRecipeJsonLd: null when no recipe / malformed JSON-LD', () => {
  assert.equal(extractRecipeJsonLd('<html>no structured data</html>'), null);
  assert.equal(extractRecipeJsonLd(''), null);
  assert.equal(extractRecipeJsonLd(null), null);
  // malformed JSON island should be skipped, not throw
  assert.equal(
    extractRecipeJsonLd('<script type="application/ld+json">{bad json</script>'),
    null
  );
});
