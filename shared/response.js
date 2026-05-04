'use strict';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

const ok = (body) => ({ statusCode: 200, headers, body: JSON.stringify(body) });
const created = (body) => ({ statusCode: 201, headers, body: JSON.stringify(body) });
const noContent = () => ({ statusCode: 204, headers });
const badRequest = (msg) => ({ statusCode: 400, headers, body: JSON.stringify({ error: msg }) });
const forbidden = (msg) => ({ statusCode: 403, headers, body: JSON.stringify({ error: msg || 'Forbidden' }) });
const notFound = (msg) => ({ statusCode: 404, headers, body: JSON.stringify({ error: msg || 'Not found' }) });
const serverError = (msg) => ({ statusCode: 500, headers, body: JSON.stringify({ error: msg || 'Internal server error' }) });

module.exports = { ok, created, noContent, badRequest, forbidden, notFound, serverError, headers };
