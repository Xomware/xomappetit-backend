'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const response = require('../shared/response');

test('success builders carry the right status codes + JSON bodies', () => {
  const okR = response.ok({ a: 1 });
  assert.equal(okR.statusCode, 200);
  assert.deepEqual(JSON.parse(okR.body), { a: 1 });

  const createdR = response.created({ id: 'x' });
  assert.equal(createdR.statusCode, 201);
  assert.deepEqual(JSON.parse(createdR.body), { id: 'x' });
});

test('error builders carry the right status codes', () => {
  assert.equal(response.badRequest('bad').statusCode, 400);
  assert.equal(response.forbidden('no').statusCode, 403);
  assert.equal(response.notFound('gone').statusCode, 404);
  assert.equal(response.serverError('boom').statusCode, 500);
});

test('every response includes permissive CORS headers', () => {
  const r = response.ok({});
  assert.ok(r.headers);
  const acao = r.headers['Access-Control-Allow-Origin'] || r.headers['access-control-allow-origin'];
  assert.ok(acao, 'expected an Access-Control-Allow-Origin header');
});
