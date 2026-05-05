'use strict';

/**
 * Macros-per-100g lookup table for common staples. Values are rounded
 * USDA-style; close enough for hobby-scale recipe tracking. Add to this
 * table when ingredients routinely fail to match.
 *
 * Lookup is substring-based and case-insensitive — 'organic chicken
 * breast' matches 'chicken breast'. Longest key wins so 'ground beef'
 * resolves to ground-beef macros, not the base 'beef' entry.
 */
const NUTRITION = {
  // Proteins (animal)
  'chicken breast': { cal: 165, p: 31, c: 0, f: 3.6 },
  'chicken thigh':  { cal: 209, p: 26, c: 0, f: 11 },
  'ground chicken': { cal: 143, p: 17, c: 0, f: 8 },
  'ground beef':    { cal: 254, p: 17, c: 0, f: 20 },
  'beef':           { cal: 250, p: 26, c: 0, f: 15 },
  'steak':          { cal: 271, p: 26, c: 0, f: 19 },
  'ground turkey':  { cal: 148, p: 19, c: 0, f: 8 },
  'turkey':         { cal: 135, p: 30, c: 0, f: 1 },
  'ground pork':    { cal: 263, p: 17, c: 0, f: 21 },
  'pork chop':      { cal: 231, p: 26, c: 0, f: 14 },
  'pork':           { cal: 242, p: 27, c: 0, f: 14 },
  'bacon':          { cal: 541, p: 37, c: 1.4, f: 42 },
  'sausage':        { cal: 296, p: 17, c: 2, f: 24 },
  'ham':            { cal: 145, p: 21, c: 1.5, f: 6 },
  'lamb':           { cal: 294, p: 25, c: 0, f: 21 },
  'salmon':         { cal: 208, p: 20, c: 0, f: 13 },
  'tuna':           { cal: 132, p: 28, c: 0, f: 1 },
  'cod':            { cal: 82, p: 18, c: 0, f: 0.7 },
  'tilapia':        { cal: 96, p: 20, c: 0, f: 1.7 },
  'shrimp':         { cal: 99, p: 24, c: 0.2, f: 0.3 },
  'scallop':        { cal: 88, p: 17, c: 4, f: 0.8 },
  'egg':            { cal: 155, p: 13, c: 1.1, f: 11 },

  // Plant proteins
  'firm tofu':      { cal: 144, p: 17, c: 3, f: 9 },
  'silken tofu':    { cal: 55,  p: 6,  c: 2, f: 3 },
  'tofu':           { cal: 76,  p: 8,  c: 2, f: 5 },
  'tempeh':         { cal: 192, p: 20, c: 8, f: 11 },
  'seitan':         { cal: 121, p: 25, c: 4, f: 1.9 },
  'chickpeas':      { cal: 164, p: 9,  c: 27, f: 2.6 },
  'black bean':     { cal: 132, p: 9,  c: 24, f: 0.5 },
  'kidney bean':    { cal: 127, p: 9,  c: 23, f: 0.5 },
  'lentil':         { cal: 116, p: 9,  c: 20, f: 0.4 },
  'edamame':        { cal: 121, p: 12, c: 9, f: 5 },

  // Dairy
  'butter':           { cal: 717, p: 0.9, c: 0.1, f: 81 },
  'unsalted butter':  { cal: 717, p: 0.9, c: 0.1, f: 81 },
  'milk':             { cal: 42,  p: 3.4, c: 5,   f: 1 },
  'whole milk':       { cal: 61,  p: 3.2, c: 4.8, f: 3.3 },
  'heavy cream':      { cal: 340, p: 2.8, c: 2.8, f: 36 },
  'sour cream':       { cal: 198, p: 2.4, c: 4.6, f: 19 },
  'greek yogurt':     { cal: 59,  p: 10,  c: 3.6, f: 0.4 },
  'yogurt':           { cal: 61,  p: 3.5, c: 4.7, f: 3.3 },
  'cream cheese':     { cal: 342, p: 6,   c: 4,   f: 34 },
  'cheddar':          { cal: 403, p: 25,  c: 1.3, f: 33 },
  'mozzarella':       { cal: 280, p: 22,  c: 2.2, f: 17 },
  'parmesan':         { cal: 431, p: 38,  c: 4.1, f: 29 },
  'feta':             { cal: 264, p: 14,  c: 4.1, f: 21 },

  // Oils / fats
  'olive oil':         { cal: 884, p: 0, c: 0, f: 100 },
  'extra virgin olive oil': { cal: 884, p: 0, c: 0, f: 100 },
  'vegetable oil':     { cal: 884, p: 0, c: 0, f: 100 },
  'canola oil':        { cal: 884, p: 0, c: 0, f: 100 },
  'sesame oil':        { cal: 884, p: 0, c: 0, f: 100 },
  'coconut oil':       { cal: 862, p: 0, c: 0, f: 100 },

  // Grains / starches
  'white rice':        { cal: 130, p: 2.7, c: 28, f: 0.3 },
  'brown rice':        { cal: 112, p: 2.6, c: 24, f: 0.9 },
  'rice':              { cal: 130, p: 2.7, c: 28, f: 0.3 },
  'quinoa':            { cal: 120, p: 4.4, c: 21, f: 1.9 },
  'pasta':             { cal: 131, p: 5,   c: 25, f: 1.1 },
  'spaghetti':         { cal: 131, p: 5,   c: 25, f: 1.1 },
  'bread':             { cal: 265, p: 9,   c: 49, f: 3.2 },
  'tortilla':          { cal: 218, p: 5.7, c: 36, f: 5 },
  'flour':             { cal: 364, p: 10,  c: 76, f: 1 },
  'all-purpose flour': { cal: 364, p: 10,  c: 76, f: 1 },
  'sugar':             { cal: 387, p: 0,   c: 100, f: 0 },
  'brown sugar':       { cal: 380, p: 0,   c: 98,  f: 0 },
  'honey':             { cal: 304, p: 0.3, c: 82,  f: 0 },
  'maple syrup':       { cal: 260, p: 0,   c: 67,  f: 0.1 },

  // Vegetables (cooked weights are similar enough for hobby-scale)
  'onion':             { cal: 40,  p: 1.1, c: 9,   f: 0.1 },
  'garlic':            { cal: 149, p: 6.4, c: 33,  f: 0.5 },
  'tomato':            { cal: 18,  p: 0.9, c: 3.9, f: 0.2 },
  'bell pepper':       { cal: 31,  p: 1,   c: 6,   f: 0.3 },
  'carrot':            { cal: 41,  p: 0.9, c: 10,  f: 0.2 },
  'celery':            { cal: 16,  p: 0.7, c: 3,   f: 0.2 },
  'potato':            { cal: 77,  p: 2,   c: 17,  f: 0.1 },
  'sweet potato':      { cal: 86,  p: 1.6, c: 20,  f: 0.1 },
  'mushroom':          { cal: 22,  p: 3.1, c: 3.3, f: 0.3 },
  'spinach':           { cal: 23,  p: 2.9, c: 3.6, f: 0.4 },
  'kale':              { cal: 49,  p: 4.3, c: 9,   f: 0.9 },
  'broccoli':          { cal: 34,  p: 2.8, c: 7,   f: 0.4 },
  'cauliflower':       { cal: 25,  p: 1.9, c: 5,   f: 0.3 },
  'zucchini':          { cal: 17,  p: 1.2, c: 3.1, f: 0.3 },
  'cucumber':          { cal: 15,  p: 0.7, c: 3.6, f: 0.1 },
  'avocado':           { cal: 160, p: 2,   c: 9,   f: 15 },
  'lemon':             { cal: 29,  p: 1.1, c: 9,   f: 0.3 },
  'lime':              { cal: 30,  p: 0.7, c: 11,  f: 0.2 },

  // Nuts / seeds
  'almond':            { cal: 579, p: 21,  c: 22, f: 50 },
  'cashew':            { cal: 553, p: 18,  c: 30, f: 44 },
  'peanut':            { cal: 567, p: 26,  c: 16, f: 49 },
  'walnut':            { cal: 654, p: 15,  c: 14, f: 65 },
  'peanut butter':     { cal: 588, p: 25,  c: 20, f: 50 },

  // Pantry
  'soy sauce':         { cal: 53,  p: 8.1, c: 5,   f: 0.6 },
  'rice vinegar':      { cal: 18,  p: 0.3, c: 0,   f: 0 },
  'apple cider vinegar': { cal: 22, p: 0,   c: 0.9, f: 0 },
  'salt':              { cal: 0,   p: 0,   c: 0,   f: 0 },
  'pepper':            { cal: 251, p: 10,  c: 64,  f: 3.3 },
  'water':             { cal: 0,   p: 0,   c: 0,   f: 0 },

  // Stocks
  'chicken stock':     { cal: 4,   p: 1,   c: 0.4, f: 0.1 },
  'beef stock':        { cal: 4,   p: 0.7, c: 0.5, f: 0.1 },
  'vegetable stock':   { cal: 4,   p: 0.5, c: 0.5, f: 0.1 },
};

/**
 * Per-piece weight (in grams) for ingredients sold by count/slice/clove.
 * Used when the unit is 'count', 'slice', or 'clove' — falls back to a
 * universal default (50g) when no entry exists.
 */
const PIECE_GRAMS = {
  'egg':            50,
  'garlic':         5,   // a clove
  'onion':          110, // medium
  'tomato':         123,
  'cherry tomato':  17,
  'lemon':          58,
  'lime':           67,
  'apple':          182,
  'banana':         118,
  'avocado':        201,
  'bell pepper':    119,
  'carrot':         61,
  'celery':         40,  // a stalk
  'potato':         173,
  'sweet potato':   130,
  'chicken breast': 174,
  'chicken thigh':  86,
  'pork chop':      150,
  'salmon':         170, // a fillet
  'tortilla':       49,
  'bread':          25,  // a slice
};

const UNIT_DEFAULT_GRAMS = {
  g: 1,
  kg: 1000,
  oz: 28.35,
  lb: 453.6,
  ml: 1,        // water-density approximation; close for stocks/dairy
  l: 1000,
  cup: 240,     // liquid baseline; per-ingredient density override below
  tbsp: 15,
  tsp: 5,
  pinch: 0.36,
  dash: 0.6,
  // count / slice / clove hand off to PIECE_GRAMS via lookupPieceGrams()
};

// Density-aware overrides for cup conversions where the universal 240g
// estimate is meaningfully off (powders + fats).
const CUP_GRAMS_OVERRIDE = {
  flour: 120, 'all-purpose flour': 120,
  sugar: 200, 'brown sugar': 220,
  butter: 227,
  'olive oil': 216, 'vegetable oil': 218, 'canola oil': 218,
  rice: 195, 'white rice': 195, 'brown rice': 195,
  quinoa: 170,
  oats: 80,
  pasta: 100,
  almond: 95, walnut: 100, cashew: 130, peanut: 146,
};

const TBSP_GRAMS_OVERRIDE = {
  flour: 8, sugar: 13, 'brown sugar': 14,
  butter: 14,
  'olive oil': 14, 'vegetable oil': 14,
  honey: 21,
};

function findEntry(table, name) {
  const haystack = (name || '').toLowerCase();
  if (!haystack) return null;
  let bestKey = null;
  for (const key of Object.keys(table)) {
    if (haystack.includes(key)) {
      if (bestKey === null || key.length > bestKey.length) bestKey = key;
    }
  }
  return bestKey ? { key: bestKey, value: table[bestKey] } : null;
}

function findNutrition(name) {
  return findEntry(NUTRITION, name);
}

function pieceGrams(name) {
  const hit = findEntry(PIECE_GRAMS, name);
  return hit ? hit.value : 50; // sane default for "1 unknown thing"
}

/**
 * Convert ingredient amount + unit to grams. Returns null if we can't
 * convert (e.g., 'to-taste' / 'pinch' without a default density).
 */
function toGrams(name, amount, unit) {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null;
  if (!unit) return null;
  const u = String(unit).toLowerCase();
  if (u === 'to-taste') return null;
  if (u === 'count' || u === 'slice' || u === 'clove') {
    return amount * pieceGrams(name);
  }
  if (u === 'cup') {
    const ovr = findEntry(CUP_GRAMS_OVERRIDE, name);
    return amount * (ovr ? ovr.value : UNIT_DEFAULT_GRAMS.cup);
  }
  if (u === 'tbsp') {
    const ovr = findEntry(TBSP_GRAMS_OVERRIDE, name);
    return amount * (ovr ? ovr.value : UNIT_DEFAULT_GRAMS.tbsp);
  }
  if (u in UNIT_DEFAULT_GRAMS) return amount * UNIT_DEFAULT_GRAMS[u];
  return null;
}

module.exports = { NUTRITION, findNutrition, pieceGrams, toGrams };
