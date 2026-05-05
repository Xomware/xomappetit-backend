'use strict';

const { ok, badRequest, serverError } = require('../../shared/response');
const { getUserId } = require('../../shared/auth');
const { extractRecipeJsonLd } = require('../../shared/recipe-jsonld');
const { callClaude, extractJson } = require('../../shared/anthropic');
const { schemaPrompt, sanitizeDraft } = require('../../shared/recipe-draft');

const MAX_HTML_BYTES = 800_000;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

/**
 * POST /recipes/import-url
 *
 * Body: { url: string }
 * Returns: { draft, source: 'json-ld' | 'claude' }
 *
 * Strategy:
 *   1. Fetch the URL, capture up to ~800KB of HTML
 *   2. Try schema.org Recipe JSON-LD extraction (works for most recipe sites — no LLM cost)
 *   3. Fall back to Claude Haiku reading the visible text
 */
exports.handler = async (event) => {
  try {
    getUserId(event); // require auth — discards return; throws if absent
    const body = JSON.parse(event.body || '{}');
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!isValidUrl(url)) return badRequest('Provide a full http(s) URL');

    const html = await fetchWithLimit(url);

    const fromJsonLd = extractRecipeJsonLd(html);
    if (fromJsonLd && fromJsonLd.name && fromJsonLd.ingredients.length > 0) {
      return ok({ draft: fromJsonLd, source: 'json-ld' });
    }

    const text = htmlToVisibleText(html).slice(0, 40_000);
    if (!text || text.length < 200) {
      return badRequest('Could not extract recipe text from that URL');
    }

    const { text: rawJson } = await callClaude({
      system: schemaPrompt(),
      prompt: `Source URL: ${url}\n\nVisible page text:\n\n${text}`,
      maxTokens: 4096,
    });
    const parsed = extractJson(rawJson);
    const draft = sanitizeDraft(parsed);
    if (!draft || !draft.name) {
      return badRequest('Could not parse a recipe from that URL');
    }
    return ok({ draft, source: 'claude' });
  } catch (err) {
    console.error('recipes-import-url error:', err);
    return serverError(err.message || 'Import failed');
  }
};

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchWithLimit(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Fetch ${res.status} ${res.statusText}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html') && !ct.includes('xml')) {
      throw new Error(`Unsupported content-type: ${ct}`);
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_HTML_BYTES) {
        chunks.push(value.subarray(0, value.byteLength - (received - MAX_HTML_BYTES)));
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip script/style and tags from HTML so the LLM gets visible body text.
 * Cheap and good enough — we don't need DOM perfection.
 */
function htmlToVisibleText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
