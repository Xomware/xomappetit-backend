'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { COOK_AXES, readAxesFromBody } = require('../shared/cook-aggregates');

test('COOK_AXES: the five rating axes are present', () => {
  const keys = COOK_AXES.map((a) => a.cookKey);
  assert.deepEqual(keys, ['rating', 'spiciness', 'sweetness', 'saltiness', 'richness']);
});

test('readAxesFromBody: picks provided axes, skips undefined, keeps null', () => {
  assert.deepEqual(readAxesFromBody({ rating: 4, spiciness: 2 }), {
    rating: 4,
    spiciness: 2,
  });
  // undefined axes are omitted entirely
  assert.deepEqual(readAxesFromBody({ rating: 5 }), { rating: 5 });
  // explicit null is preserved (clears an axis)
  assert.deepEqual(readAxesFromBody({ rating: null, sweetness: 3 }), {
    rating: null,
    sweetness: 3,
  });
  assert.deepEqual(readAxesFromBody({}), {});
});

test('readAxesFromBody: throws on out-of-range / non-numeric values', () => {
  assert.throws(() => readAxesFromBody({ rating: 0 }), /between 1 and 5/);
  assert.throws(() => readAxesFromBody({ rating: 6 }), /between 1 and 5/);
  assert.throws(() => readAxesFromBody({ spiciness: 'hot' }), /between 1 and 5/);
});
