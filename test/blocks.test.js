'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// These tests run with no BLOCKS_TABLE_NAME set, so both helpers short-circuit
// before any DynamoDB I/O — we're asserting the guard logic only.
const { blockedIdsOf, blockExistsBetween } = require('../shared/blocks');

test('blockedIdsOf: empty Set when caller missing or table unset', async () => {
  delete process.env.BLOCKS_TABLE_NAME;
  assert.deepEqual([...(await blockedIdsOf(null))], []);
  assert.deepEqual([...(await blockedIdsOf('user-1'))], []); // no table -> empty
});

test('blockExistsBetween: false for self / missing ids / no table', async () => {
  delete process.env.BLOCKS_TABLE_NAME;
  assert.equal(await blockExistsBetween('a', 'a'), false); // self
  assert.equal(await blockExistsBetween(null, 'b'), false);
  assert.equal(await blockExistsBetween('a', null), false);
  assert.equal(await blockExistsBetween('a', 'b'), false); // no table configured
});
