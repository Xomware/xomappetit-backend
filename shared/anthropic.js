'use strict';

/**
 * Thin Anthropic Messages API client. Uses raw fetch instead of @anthropic-ai/sdk
 * to avoid bundling ~2MB of unused TS types in every Lambda zip.
 *
 * Reads ANTHROPIC_API_KEY from the environment — wired in via Terraform from
 * the org's DEV_ANTHROPIC_API_KEY GitHub secret.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
// Haiku is enough for structured extraction and ~10x cheaper than Sonnet.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

async function callClaude({
  system,
  prompt,
  model = DEFAULT_MODEL,
  maxTokens = 4096,
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return { text, usage: data.usage };
}

/**
 * Pulls the first {...} JSON object out of a Claude response. Tolerates
 * the model wrapping its answer in markdown fences or stray prose.
 */
function extractJson(text) {
  if (!text) return null;
  // Strip markdown fences if present.
  let cleaned = text;
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1];
  // Find the first balanced JSON object.
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  let inStr = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(cleaned.slice(start, end));
  } catch {
    return null;
  }
}

module.exports = { callClaude, extractJson };
