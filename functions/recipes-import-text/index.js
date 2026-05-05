'use strict';

const { ok, badRequest, serverError } = require('../../shared/response');
const { getUserId } = require('../../shared/auth');
const { callClaude, extractJson } = require('../../shared/anthropic');
const { schemaPrompt, sanitizeDraft } = require('../../shared/recipe-draft');

const MAX_INPUT_CHARS = 12_000;

/**
 * POST /recipes/import-text
 *
 * Body: { text: string }
 * Returns: { draft, source: 'claude' }
 *
 * Catch-all path for content that isn't a clean URL — Instagram captions,
 * TikTok captions, screenshots OCR'd to text, recipes pasted from Notes,
 * etc. The LLM does the heavy lifting; the sanitizer enforces our schema.
 */
exports.handler = async (event) => {
  try {
    getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length < 30) {
      return badRequest('Paste at least a sentence of recipe text');
    }

    const trimmed = text.slice(0, MAX_INPUT_CHARS);
    const { text: rawJson } = await callClaude({
      system: schemaPrompt(),
      prompt: `Pasted text (may be a social-media caption, blog excerpt, or note):\n\n${trimmed}`,
      maxTokens: 4096,
    });
    const parsed = extractJson(rawJson);
    const draft = sanitizeDraft(parsed);
    if (!draft || !draft.name) {
      return badRequest('Could not parse a recipe from that text');
    }
    return ok({ draft, source: 'claude' });
  } catch (err) {
    console.error('recipes-import-text error:', err);
    return serverError(err.message || 'Import failed');
  }
};
