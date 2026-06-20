'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  COOK_AXES,
  readAxesFromBody,
  computeAxisAggregates,
} = require('../shared/cook-aggregates');

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

test('computeAxisAggregates: averages valid values, 2-decimal rounding', () => {
  const agg = computeAxisAggregates([{ rating: 5 }, { rating: 4 }, { rating: 5 }]);
  assert.equal(agg.avgRating, 4.67);
  assert.equal(agg.ratingCount, 3);
});

test('computeAxisAggregates: pools cooks + direct ratings as one set', () => {
  // 2 cook rows + 1 direct-rating row, all carrying the same axis keys
  const events = [
    { rating: 5, spiciness: 4 }, // cook
    { rating: 3, spiciness: 2 }, // cook
    { rating: 1 }, // direct rating, no spiciness
  ];
  const agg = computeAxisAggregates(events);
  assert.equal(agg.ratingCount, 3);
  assert.equal(agg.avgRating, 3); // (5+3+1)/3
  assert.equal(agg.spicinessCount, 2); // only two carried spiciness
  assert.equal(agg.spicinessAvg, 3); // (4+2)/2
});

test('computeAxisAggregates: ignores out-of-range / missing, null avg when empty', () => {
  const agg = computeAxisAggregates([{ rating: 6 }, { rating: 'x' }, { rating: null }, {}]);
  assert.equal(agg.ratingCount, 0);
  assert.equal(agg.avgRating, null);
  // empty input is safe
  const empty = computeAxisAggregates([]);
  assert.equal(empty.ratingCount, 0);
  assert.equal(empty.avgRating, null);
});
