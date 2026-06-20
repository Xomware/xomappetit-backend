'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findNutrition, pieceGrams, toGrams } = require('../shared/nutrition');

test('findNutrition: substring match, longest key wins, null on miss', () => {
  const hit = findNutrition('organic chicken breast, diced');
  assert.equal(hit.key, 'chicken breast');
  assert.ok(hit.value && typeof hit.value.cal === 'number');
  assert.equal(findNutrition('moon dust'), null);
});

test('pieceGrams: known pieces, default fallback 50g', () => {
  assert.equal(pieceGrams('egg'), 50);
  assert.equal(pieceGrams('totally unknown thing'), 50);
});

test('toGrams: gram passthrough, piece counts, density overrides', () => {
  assert.equal(toGrams('chicken breast', 100, 'g'), 100);
  assert.equal(toGrams('egg', 2, 'count'), 100); // 2 * 50g
  // flour is lighter than water: cup override is 120g, not the 240 default
  assert.equal(toGrams('flour', 1, 'cup'), 120);
});

test('toGrams: returns null for unmeasurable inputs', () => {
  assert.equal(toGrams('salt', 1, 'to-taste'), null);
  assert.equal(toGrams('beef', null, 'cup'), null);
  assert.equal(toGrams('beef', -2, 'g'), null);
  assert.equal(toGrams('beef', 2, null), null);
});
