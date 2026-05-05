'use strict';

const { sanitizeDraft } = require('./recipe-draft');

/**
 * Best-effort extraction of a Recipe-typed JSON-LD island from raw HTML.
 * Most major recipe sites (HelloFresh, AllRecipes, NYT Cooking, Bon Appétit,
 * Serious Eats, Food Network, most blog plugins) emit one of these so we can
 * skip the LLM entirely when present.
 *
 * Returns a sanitized draft (same shape as the LLM path) or null if no
 * Recipe-typed island is found.
 */
function extractRecipeJsonLd(html) {
  if (typeof html !== 'string' || !html) return null;

  const islands = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (islands.length === 0) return null;

  for (const m of islands) {
    const blob = m[1];
    if (!blob) continue;
    let parsed;
    try {
      parsed = JSON.parse(blob.trim());
    } catch {
      continue;
    }
    const recipe = findRecipeNode(parsed);
    if (recipe) {
      const draft = jsonLdToDraft(recipe);
      const sanitized = sanitizeDraft(draft);
      if (sanitized && sanitized.name) return sanitized;
    }
  }
  return null;
}

function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findRecipeNode(item);
      if (hit) return hit;
    }
    return null;
  }
  // @graph holds an array of types; recurse.
  if (Array.isArray(node['@graph'])) {
    const hit = findRecipeNode(node['@graph']);
    if (hit) return hit;
  }
  const t = node['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  return null;
}

/**
 * Translate the schema.org Recipe shape to our draft shape. We do a best-effort
 * pass — the sanitizer downstream drops anything bogus.
 */
function jsonLdToDraft(r) {
  const name = clean(r.name);
  const description = clean(r.description || r.headline || '');

  const time = parseDurationMinutes(r.totalTime) ?? sumMinutes(r.prepTime, r.cookTime);

  const yieldText = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield;
  const servings = parseInt(String(yieldText || ''), 10) || 1;

  const ingredients = (r.recipeIngredient || []).map(parseIngredientLine);

  const instructionsRaw = flattenInstructions(r.recipeInstructions);
  const instructions = instructionsRaw.map((text) => ({ text, ingredientIndexes: [] }));

  const macros = parseNutrition(r.nutrition);
  const macrosScope = 'per-serving'; // schema.org nutrition is per serving by convention

  // schema.org has a recipeCategory + keywords; map both to our tag whitelist.
  const tagSeeds = [
    ...arrify(r.recipeCategory),
    ...arrify(r.recipeCuisine),
    ...arrify(r.keywords),
    ...(typeof r.keywords === 'string' ? r.keywords.split(',') : []),
  ];

  // Guess proteinTypes from keywords + ingredient names. The sanitizer will drop unknowns.
  const proteinSeeds = guessProteinSeeds(ingredients);

  return {
    name,
    description,
    timeMinutes: time ?? 0,
    servings,
    difficulty: 3,
    proteinSource: '',
    proteinTypes: proteinSeeds,
    tags: tagSeeds,
    ingredients,
    instructions,
    macros,
    macrosScope,
  };
}

function arrify(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

function clean(s) {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

function parseDurationMinutes(iso) {
  if (!iso || typeof iso !== 'string') return null;
  // ISO 8601 duration "PT1H30M" / "PT45M"
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  return h * 60 + min;
}

function sumMinutes(a, b) {
  const x = parseDurationMinutes(a) || 0;
  const y = parseDurationMinutes(b) || 0;
  const total = x + y;
  return total > 0 ? total : null;
}

function flattenInstructions(steps) {
  if (!steps) return [];
  if (typeof steps === 'string') {
    return steps
      .split(/\n+|(?<=\.)\s+(?=[A-Z])/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(steps)) return [];
  const out = [];
  for (const item of steps) {
    if (typeof item === 'string') {
      out.push(item.trim());
    } else if (item && typeof item === 'object') {
      // HowToSection has itemListElement; HowToStep has text
      if (Array.isArray(item.itemListElement)) {
        for (const sub of flattenInstructions(item.itemListElement)) out.push(sub);
      } else if (typeof item.text === 'string') {
        out.push(clean(item.text));
      } else if (typeof item.name === 'string') {
        out.push(clean(item.name));
      }
    }
  }
  return out.filter(Boolean);
}

/**
 * Parse a free-text ingredient line like "1 1/2 cups all-purpose flour" into
 * { name, amount, unit }. Falls back to name-only when parsing fails — the
 * downstream normalizer happily takes that.
 */
function parseIngredientLine(line) {
  if (!line || typeof line !== 'string') return { name: '', amount: null, unit: null };
  const cleaned = line.replace(/\s+/g, ' ').trim();
  // Try to match: <amount> <unit> <rest>
  // Amount = integer, decimal, fraction (1/2), or mixed (1 1/2)
  const re = /^([\d./\s]+?)\s+([A-Za-z]+)\s+(.+)$/;
  const m = cleaned.match(re);
  if (m) {
    const amount = parseAmount(m[1]);
    const unit = mapUnit(m[2]);
    const name = m[3].trim().toLowerCase();
    if (amount != null || unit) return { name, amount, unit };
  }
  return { name: cleaned.toLowerCase(), amount: null, unit: null };
}

function parseAmount(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  // Mixed: "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }
  // Fraction: "1/2"
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const UNIT_ALIASES = {
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbsps: 'tbsp', tb: 'tbsp', t: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', tsps: 'tsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  gram: 'g', grams: 'g', g: 'g', gr: 'g',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  milliliter: 'ml', milliliters: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', l: 'l',
  clove: 'clove', cloves: 'clove',
  slice: 'slice', slices: 'slice',
  can: 'can', cans: 'can',
  pinch: 'pinch', pinches: 'pinch',
  dash: 'dash', dashes: 'dash',
};

function mapUnit(raw) {
  const k = String(raw || '').toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[k] || null;
}

function parseNutrition(n) {
  if (!n || typeof n !== 'object') return { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const num = (v) => {
    if (v == null) return 0;
    const m = String(v).match(/[\d.]+/);
    return m ? Number(m[0]) || 0 : 0;
  };
  return {
    calories: num(n.calories),
    protein: num(n.proteinContent),
    carbs: num(n.carbohydrateContent),
    fat: num(n.fatContent),
  };
}

function guessProteinSeeds(ingredients) {
  const found = new Set();
  const text = ingredients.map((i) => (i?.name || '').toLowerCase()).join(' ');
  const KEYWORD_TO_TYPE = {
    chicken: 'chicken', beef: 'beef', steak: 'beef', 'ground beef': 'beef',
    pork: 'pork', bacon: 'pork', ham: 'pork', sausage: 'pork',
    turkey: 'turkey', lamb: 'lamb',
    salmon: 'salmon', tuna: 'tuna',
    fish: 'fish', cod: 'fish', tilapia: 'fish', halibut: 'fish',
    shrimp: 'shrimp', prawn: 'shrimp',
    scallop: 'shellfish', mussel: 'shellfish', clam: 'shellfish', crab: 'shellfish', lobster: 'shellfish',
    tofu: 'tofu', tempeh: 'tempeh', seitan: 'seitan',
    chickpea: 'chickpeas', 'black bean': 'beans', 'kidney bean': 'beans',
    lentil: 'lentils',
    egg: 'eggs',
  };
  for (const [kw, tp] of Object.entries(KEYWORD_TO_TYPE)) {
    if (text.includes(kw)) found.add(tp);
  }
  return Array.from(found);
}

module.exports = { extractRecipeJsonLd };
