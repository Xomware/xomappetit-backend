'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeMacros } = require('../shared/macros-calc');

test('computeMacros: single matched ingredient, per-recipe', () => {
  const { macros, coverage } = computeMacros(
    [{ name: 'chicken breast', amount: 100, unit: 'g' }],
    { servings: 1, macrosScope: 'per-recipe' }
  );
  assert.equal(coverage.matched, 1);
  assert.equal(coverage.total, 1);
  assert.deepEqual(coverage.unmatched, []);
  // chicken breast ~165cal/31p per 100g
  assert.ok(macros.calories > 150 && macros.calories < 180);
  assert.ok(macros.protein >= 28 && macros.protein <= 34);
  // macros are rounded integers
  assert.equal(macros.calories, Math.round(macros.calories));
});

test('computeMacros: unmatched ingredient is reported, not counted', () => {
  const { coverage } = computeMacros([{ name: 'fancy spice rub' }], {});
  assert.equal(coverage.matched, 0);
  assert.equal(coverage.total, 1);
  assert.deepEqual(coverage.unmatched, ['fancy spice rub']);
});

test('computeMacros: per-serving divides totals by servings', () => {
  const ingredients = [{ name: 'chicken breast', amount: 400, unit: 'g' }];
  const whole = computeMacros(ingredients, { servings: 4, macrosScope: 'per-recipe' });
  const each = computeMacros(ingredients, { servings: 4, macrosScope: 'per-serving' });
  // per-serving calories should be ~1/4 of the per-recipe total (within rounding)
  assert.ok(Math.abs(each.macros.calories - whole.macros.calories / 4) <= 1);
  assert.equal(each.macrosScope, 'per-serving');
  assert.equal(each.servings, 4);
});

test('computeMacros: empty/garbage input yields zeros, no matches', () => {
  const { macros, coverage } = computeMacros([], {});
  assert.deepEqual(macros, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  assert.equal(coverage.matched, 0);
});
