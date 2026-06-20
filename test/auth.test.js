'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getUserId, getGroups, isAdmin } = require('../shared/auth');

const eventWith = (claims) => ({ requestContext: { authorizer: { claims } } });

test('getUserId: returns sub claim, throws when absent', () => {
  assert.equal(getUserId(eventWith({ sub: 'uuid-123' })), 'uuid-123');
  assert.throws(() => getUserId({ requestContext: {} }));
  assert.throws(() => getUserId({}));
});

test('getGroups: handles bracketed string, plain string, array, missing', () => {
  assert.deepEqual(getGroups(eventWith({ 'cognito:groups': '[admin, beta]' })), [
    'admin',
    'beta',
  ]);
  assert.deepEqual(getGroups(eventWith({ 'cognito:groups': 'user' })), ['user']);
  assert.deepEqual(getGroups(eventWith({ 'cognito:groups': ['a', 'b'] })), ['a', 'b']);
  assert.deepEqual(getGroups(eventWith({})), []);
  assert.deepEqual(getGroups({}), []);
});

test('isAdmin: true only when admin present in groups', () => {
  assert.equal(isAdmin(eventWith({ 'cognito:groups': 'admin' })), true);
  assert.equal(isAdmin(eventWith({ 'cognito:groups': '[admin, user]' })), true);
  assert.equal(isAdmin(eventWith({ 'cognito:groups': 'user' })), false);
  assert.equal(isAdmin({}), false);
});
