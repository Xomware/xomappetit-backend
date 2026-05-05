'use strict';

const {
  PROTEIN_TYPES,
  TAGS,
  UNITS,
  UNITLESS,
  normalizeIngredients,
  normalizeInstructions,
  normalizeProteinTypes,
  normalizeTags,
  normalizeDifficulty,
  normalizeServings,
  normalizeMacros,
  normalizeMacrosScope,
} = require('./ingredients');

/**
 * Schema text included in the LLM system prompt so the model knows the exact
 * vocabulary to emit. Keep this in lockstep with shared/ingredients.js — the
 * normalizers below silently drop anything not in this whitelist.
 */
function schemaPrompt() {
  return `You extract structured cooking-recipe data from messy text.

Return EXACTLY ONE JSON object — no prose, no markdown fences, no preamble. The shape:

{
  "name": string,                                  // short and recipe-y
  "description": string,                           // 1-2 sentences, ok to leave ""
  "timeMinutes": number,                           // integer total prep+cook minutes; 0 if unknown
  "servings": number,                              // integer 1..50
  "difficulty": 1 | 2 | 3 | 4 | 5,                 // 3 if unsure
  "proteinSource": string,                         // optional free-text refinement, e.g. "bone-in chicken thigh"; "" if none
  "proteinTypes": string[],                        // SUBSET of: ${[...PROTEIN_TYPES].join(', ')}
  "tags": string[],                                // SUBSET of: ${[...TAGS].join(', ')}
  "ingredients": [
    {
      "name": string,                              // lowercase, e.g. "garlic clove"
      "amount": number | null,                     // null when not numeric (e.g. "to taste")
      "unit": string | null                        // SUBSET of: ${[...UNITS].join(', ')}
    }
  ],
  "instructions": [
    {
      "text": string,                              // one step
      "ingredientIndexes": number[]                // 0-based indexes into ingredients[] used in this step
    }
  ],
  "macros": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "macrosScope": "per-recipe" | "per-serving"
}

Rules:
- Convert fractions like 1/2 → 0.5, 1 1/2 → 1.5
- Convert "tablespoon"/"tablespoons" → "tbsp"; "teaspoon" → "tsp"; "ounce" → "oz"; "pound" → "lb"; "gram" → "g"; "milliliter" → "ml"; "liter" → "l"
- "to taste" / "salt and pepper to taste" → unit: "to-taste", amount: null
- Pinches and dashes → unit "pinch" / "dash", amount: null
- Pick proteinTypes that match the actual proteins; only pick tags that genuinely apply
- For each instruction step, identify which ingredients (by 0-based index) the step uses; empty array if none
- If you can't read macros from the source, return all zeros and macrosScope "per-recipe"`;
}

/**
 * Coerce an LLM-emitted draft into a shape that recipes-create accepts.
 * Drops anything outside the enums; clamps numerics; ensures arrays are arrays.
 */
function sanitizeDraft(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const ingredients = normalizeIngredients(raw.ingredients);
  const ingCount = ingredients.length;
  const instructions = normalizeInstructions(raw.instructions).map((step) => ({
    text: step.text,
    ingredientIndexes: (step.ingredientIndexes || []).filter(
      (n) => Number.isInteger(n) && n >= 0 && n < ingCount,
    ),
  }));

  return {
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    timeMinutes: Number.isFinite(Number(raw.timeMinutes))
      ? Math.max(0, Math.round(Number(raw.timeMinutes)))
      : 0,
    servings: normalizeServings(raw.servings ?? 1),
    difficulty: normalizeDifficulty(raw.difficulty),
    proteinSource:
      typeof raw.proteinSource === 'string' ? raw.proteinSource.trim() : '',
    proteinTypes: normalizeProteinTypes(raw.proteinTypes),
    tags: normalizeTags(raw.tags),
    ingredients,
    instructions,
    macros: normalizeMacros(raw.macros),
    macrosScope: normalizeMacrosScope(raw.macrosScope),
  };
}

module.exports = { schemaPrompt, sanitizeDraft, UNITLESS };
