'use strict';

const { PROTEIN_TYPES } = require('./ingredients');

/**
 * Map ingredient-name keywords to canonical ProteinType values. Substring
 * matched, case-insensitive, longest-keyword wins to keep more-specific
 * matches ('ground beef' → beef, 'salmon' → salmon not fish).
 *
 * Add new keywords here when an ingredient routinely fails to detect.
 */
const KEYWORD_TO_TYPE = [
  // Beef
  ['ribeye', 'beef'], ['skirt steak', 'beef'], ['flank steak', 'beef'],
  ['ground beef', 'beef'], ['steak', 'beef'], ['sirloin', 'beef'],
  ['brisket', 'beef'], ['beef', 'beef'],
  // Chicken
  ['chicken breast', 'chicken'], ['chicken thigh', 'chicken'],
  ['ground chicken', 'chicken'], ['rotisserie chicken', 'chicken'],
  ['whole chicken', 'chicken'], ['chicken', 'chicken'],
  // Pork
  ['ground pork', 'pork'], ['pork chop', 'pork'], ['pork tenderloin', 'pork'],
  ['pork shoulder', 'pork'], ['bacon', 'pork'], ['pancetta', 'pork'],
  ['prosciutto', 'pork'], ['sausage', 'pork'], ['chorizo', 'pork'],
  ['ham', 'pork'], ['pork', 'pork'],
  // Turkey / Lamb
  ['ground turkey', 'turkey'], ['turkey', 'turkey'],
  ['ground lamb', 'lamb'], ['lamb', 'lamb'],
  // Specific fish first, then generic fish
  ['salmon', 'salmon'], ['tuna', 'tuna'],
  ['cod', 'fish'], ['tilapia', 'fish'], ['halibut', 'fish'],
  ['mahi mahi', 'fish'], ['sea bass', 'fish'], ['trout', 'fish'],
  ['snapper', 'fish'], ['fish', 'fish'],
  // Shellfish
  ['shrimp', 'shrimp'], ['prawn', 'shrimp'],
  ['scallop', 'shellfish'], ['lobster', 'shellfish'],
  ['crab', 'shellfish'], ['mussel', 'shellfish'],
  ['clam', 'shellfish'], ['oyster', 'shellfish'],
  ['shellfish', 'shellfish'],
  // Plant proteins
  ['firm tofu', 'tofu'], ['silken tofu', 'tofu'], ['tofu', 'tofu'],
  ['tempeh', 'tempeh'], ['seitan', 'seitan'],
  // Legumes
  ['chickpea', 'chickpeas'], ['garbanzo', 'chickpeas'],
  ['lentil', 'lentils'],
  ['black bean', 'beans'], ['kidney bean', 'beans'], ['pinto bean', 'beans'],
  ['cannellini bean', 'beans'], ['edamame', 'beans'], ['bean', 'beans'],
  // Eggs / dairy / nuts
  ['egg', 'eggs'],
  ['cheese', 'dairy'], ['ricotta', 'dairy'], ['mozzarella', 'dairy'],
  ['parmesan', 'dairy'], ['feta', 'dairy'], ['goat cheese', 'dairy'],
  ['greek yogurt', 'dairy'],
  ['almond', 'nuts'], ['walnut', 'nuts'], ['cashew', 'nuts'],
  ['pecan', 'nuts'], ['pistachio', 'nuts'], ['peanut', 'nuts'],
  ['hazelnut', 'nuts'], ['pine nut', 'nuts'],
];

// Sort by descending keyword length so 'ground beef' always wins over 'beef'.
const SORTED = [...KEYWORD_TO_TYPE].sort((a, b) => b[0].length - a[0].length);

/**
 * Returns the deduplicated ProteinType set implied by an ingredient list.
 * The detector is conservative — leaves the set empty if nothing obvious
 * is present rather than guessing.
 */
function detectProteinTypes(ingredients) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return [];
  const out = new Set();
  for (const ing of ingredients) {
    const name = typeof ing === 'string' ? ing : ing?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    const haystack = name.toLowerCase();
    for (const [kw, type] of SORTED) {
      if (haystack.includes(kw)) {
        if (PROTEIN_TYPES.has(type)) out.add(type);
        break; // longest-match wins, stop scanning this ingredient
      }
    }
  }
  return Array.from(out);
}

module.exports = { detectProteinTypes };
