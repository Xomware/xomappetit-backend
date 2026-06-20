'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { detectProteinTypes } = require('../shared/protein-detect');

test('detectProteinTypes: longest keyword wins (ground beef -> beef, not duplicated)', () => {
  assert.deepEqual(detectProteinTypes([{ name: 'ground beef' }, 'garlic', 'rice']), ['beef']);
});

test('detectProteinTypes: multiple distinct proteins, deduped', () => {
  const out = detectProteinTypes(['chicken breast', 'olive oil', 'black bean']).sort();
  assert.deepEqual(out, ['beans', 'chicken']);
  assert.deepEqual(detectProteinTypes(['tofu', 'firm tofu', 'mushroom']), ['tofu']);
});

test('detectProteinTypes: nothing obvious -> empty, bad input -> empty', () => {
  assert.deepEqual(detectProteinTypes(['water', 'salt', 'sugar']), []);
  assert.deepEqual(detectProteinTypes(null), []);
  assert.deepEqual(detectProteinTypes([]), []);
});
