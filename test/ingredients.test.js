'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeUnit,
  normalizeAmount,
  normalizeIngredient,
  normalizeIngredients,
  normalizeInstruction,
  normalizeInstructions,
  normalizeProteinTypes,
  normalizeTags,
  normalizeDifficulty,
  normalizeServings,
  normalizeMacrosScope,
  normalizeMacros,
} = require('../shared/ingredients');

test('normalizeUnit: canonicalizes case + whitespace, rejects unknown', () => {
  assert.equal(normalizeUnit('Cup'), 'cup');
  assert.equal(normalizeUnit('  TSP  '), 'tsp');
  assert.equal(normalizeUnit('lb'), 'lb');
  assert.equal(normalizeUnit('furlong'), null);
  assert.equal(normalizeUnit(''), null);
  assert.equal(normalizeUnit(null), null);
  assert.equal(normalizeUnit(undefined), null);
});

test('normalizeAmount: coerces, rejects negatives/NaN, nulls for unitless', () => {
  assert.equal(normalizeAmount(2.5, 'cup'), 2.5);
  assert.equal(normalizeAmount('100', 'g'), 100);
  assert.equal(normalizeAmount(-5, 'g'), null);
  assert.equal(normalizeAmount('abc', 'g'), null);
  assert.equal(normalizeAmount('', 'g'), null);
  // unitless units never carry a numeric amount
  assert.equal(normalizeAmount(2, 'pinch'), null);
  assert.equal(normalizeAmount(1, 'to-taste'), null);
});

test('normalizeIngredient: string -> structured, object trims + normalizes', () => {
  assert.deepEqual(normalizeIngredient('garlic'), {
    name: 'garlic',
    amount: null,
    unit: null,
  });
  assert.deepEqual(
    normalizeIngredient({ name: '  chicken  ', amount: 2, unit: 'Cup' }),
    { name: 'chicken', amount: 2, unit: 'cup' }
  );
  // legacy `quantity` is accepted as an alias for amount
  assert.deepEqual(
    normalizeIngredient({ name: 'rice', quantity: 1, unit: 'cup' }),
    { name: 'rice', amount: 1, unit: 'cup' }
  );
  // unitless drops the amount
  assert.deepEqual(
    normalizeIngredient({ name: 'salt', amount: 1, unit: 'pinch' }),
    { name: 'salt', amount: null, unit: 'pinch' }
  );
});

test('normalizeIngredients: non-arrays -> [], empty names filtered', () => {
  assert.deepEqual(normalizeIngredients(null), []);
  assert.deepEqual(normalizeIngredients('flour'), []);
  assert.deepEqual(normalizeIngredients([{ name: '   ', amount: 1, unit: 'cup' }]), []);
  const out = normalizeIngredients(['flour', { name: 'salt' }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'flour');
});

test('normalizeInstruction(s): string -> {text, ingredientIndexes}, empties filtered', () => {
  assert.deepEqual(normalizeInstruction('Mix it'), {
    text: 'Mix it',
    ingredientIndexes: [],
  });
  const step = normalizeInstruction({ text: '  Heat  ', ingredientIndexes: [0, 1, -1, 2.5] });
  assert.equal(step.text, 'Heat');
  // negative / non-integer indexes are dropped
  assert.deepEqual(step.ingredientIndexes, [0, 1]);

  assert.deepEqual(normalizeInstructions(null), []);
  assert.equal(normalizeInstructions(['Step 1', '   ', 'Step 2']).length, 2);
});

test('normalizeProteinTypes: lowercases, dedupes, drops unknown', () => {
  assert.deepEqual(normalizeProteinTypes(['Chicken', 'BEEF', 'chicken']).sort(), [
    'beef',
    'chicken',
  ]);
  assert.deepEqual(normalizeProteinTypes(['chicken', 'unicorn', 'fish']).sort(), [
    'chicken',
    'fish',
  ]);
  assert.deepEqual(normalizeProteinTypes(null), []);
});

test('normalizeTags: lowercases, dedupes, drops unknown', () => {
  assert.deepEqual(
    normalizeTags(['Vegetarian', 'quick', 'SPICY', 'vegetarian']).sort(),
    ['quick', 'spicy', 'vegetarian']
  );
  assert.deepEqual(normalizeTags(['dinner', 'not-a-real-tag']), ['dinner']);
  assert.deepEqual(normalizeTags(null), []);
});

test('normalizeDifficulty: legacy enum migration + clamp to 1..5', () => {
  assert.equal(normalizeDifficulty('Easy'), 2);
  assert.equal(normalizeDifficulty('Medium'), 3);
  assert.equal(normalizeDifficulty('Hard'), 4);
  assert.equal(normalizeDifficulty(4.7), 5);
  assert.equal(normalizeDifficulty(0), 1);
  assert.equal(normalizeDifficulty(99), 5);
  assert.equal(normalizeDifficulty('garbage'), 3);
});

test('normalizeServings: defaults to 1, clamps to [1,50], rounds', () => {
  assert.equal(normalizeServings(4), 4);
  assert.equal(normalizeServings(55), 50);
  assert.equal(normalizeServings(0.5), 1);
  assert.equal(normalizeServings(null), 1);
  assert.equal(normalizeServings('garbage'), 1);
});

test('normalizeMacrosScope: passthrough valid, else per-recipe', () => {
  assert.equal(normalizeMacrosScope('per-serving'), 'per-serving');
  assert.equal(normalizeMacrosScope('per-recipe'), 'per-recipe');
  assert.equal(normalizeMacrosScope('weird'), 'per-recipe');
  assert.equal(normalizeMacrosScope(undefined), 'per-recipe');
});

test('normalizeMacros: object -> 4 numeric fields, negatives/NaN -> 0', () => {
  assert.deepEqual(normalizeMacros({ calories: 500, protein: 30, carbs: 40, fat: 20 }), {
    calories: 500,
    protein: 30,
    carbs: 40,
    fat: 20,
  });
  assert.deepEqual(normalizeMacros({ calories: -100, protein: 'x' }), {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });
  assert.deepEqual(normalizeMacros(null), { calories: 0, protein: 0, carbs: 0, fat: 0 });
});
