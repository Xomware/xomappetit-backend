'use strict';

/**
 * Seed a starter recipe library into the LIVE Xom Appétit tables so the
 * Discover feed isn't an empty shell on first open.
 *
 * Data is built by reusing the same shared modules the real handlers use
 * (recipes-create / cooks-log), so seeded rows are byte-identical to what
 * a real user would create: macros computed from ingredients, proteinTypes
 * auto-detected, rating aggregates re-derived from logged cooks.
 *
 * Usage:
 *   AWS_REGION=us-east-1 \
 *   RECIPES_TABLE_NAME=xomappetit-recipes \
 *   COOKS_TABLE_NAME=xomappetit-cooks \
 *   COOK_PARTICIPANTS_TABLE_NAME=xomappetit-cook-participants \
 *   AUTHOR_USER_ID=<cognito-sub> \
 *   node scripts/seed-starter-library.js [--dry-run]
 */

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../shared/dynamo');
const {
  normalizeIngredients,
  normalizeInstructions,
  normalizeProteinTypes,
  normalizeTags,
  normalizeDifficulty,
  normalizeServings,
  normalizeMacrosScope,
  normalizeMacros,
} = require('../shared/ingredients');
const { detectProteinTypes } = require('../shared/protein-detect');
const { computeMacros } = require('../shared/macros-calc');
const {
  readAxesFromBody,
  recomputeRecipeAggregatesFromCooks,
} = require('../shared/cook-aggregates');

const DRY_RUN = process.argv.includes('--dry-run');
const AUTHOR_USER_ID = process.env.AUTHOR_USER_ID;
if (!AUTHOR_USER_ID) throw new Error('AUTHOR_USER_ID env var is required');

const RECIPES_TABLE = process.env.RECIPES_TABLE_NAME;
const COOKS_TABLE = process.env.COOKS_TABLE_NAME;
const COOK_PARTICIPANTS_TABLE = process.env.COOK_PARTICIPANTS_TABLE_NAME;

// Spread createdAt over the last few weeks so the feed has a natural,
// lived-in ordering instead of a single timestamp wall.
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgoISO(days, hour = 18) {
  const d = new Date(Date.now() - days * DAY_MS);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/**
 * Each entry: a recipe + optional `cooks` (each with rating axes 1..5).
 * Ingredient names are chosen to match the static nutrition table so the
 * macro panel shows real numbers with full coverage.
 */
const LIBRARY = [
  {
    name: 'Weeknight Chicken Stir-Fry',
    description: 'Fast, glossy, and endlessly riffable — the dinner you make when the fridge is half-empty and you have 20 minutes.',
    timeMinutes: 20, servings: 4, difficulty: 2, daysAgo: 1,
    tags: ['dinner', 'quick', 'high-protein', 'one-pan'],
    ingredients: [
      { name: 'chicken breast', quantity: 1.5, unit: 'lb' },
      { name: 'broccoli', quantity: 3, unit: 'cup' },
      { name: 'bell pepper', quantity: 2, unit: 'count' },
      { name: 'soy sauce', quantity: 3, unit: 'tbsp' },
      { name: 'sesame oil', quantity: 1, unit: 'tbsp' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
      { name: 'white rice', quantity: 2, unit: 'cup' },
    ],
    instructions: [
      'Slice the chicken thin and cook in a hot wok with a little sesame oil until just browned.',
      'Add garlic, broccoli, and peppers; stir-fry 4–5 minutes until crisp-tender.',
      'Pour in soy sauce, toss to glaze, and serve over steamed rice.',
    ],
    cooks: [
      { rating: 5, spiciness: 1, saltiness: 4, richness: 3, notes: 'House favorite. Doubled the garlic.' },
      { rating: 4, spiciness: 2, saltiness: 3, richness: 3 },
      { rating: 5, spiciness: 1, saltiness: 4, richness: 2 },
    ],
  },
  {
    name: 'Creamy Garlic Butter Salmon',
    description: 'Restaurant-feel salmon with a silky pan sauce. Looks fancy, takes 25 minutes, wrecks zero patience.',
    timeMinutes: 25, servings: 2, difficulty: 2, daysAgo: 3,
    tags: ['dinner', 'date-night', 'high-protein', 'low-carb'],
    ingredients: [
      { name: 'salmon', quantity: 12, unit: 'oz' },
      { name: 'butter', quantity: 3, unit: 'tbsp' },
      { name: 'garlic', quantity: 4, unit: 'clove' },
      { name: 'heavy cream', quantity: 0.5, unit: 'cup' },
      { name: 'spinach', quantity: 2, unit: 'cup' },
      { name: 'lemon', quantity: 1, unit: 'count' },
    ],
    instructions: [
      'Sear salmon skin-side down in butter until crisp; flip and finish, then set aside.',
      'Soften garlic in the same pan, add cream and a squeeze of lemon, simmer to thicken.',
      'Wilt spinach into the sauce, return salmon, spoon sauce over, and serve.',
    ],
    cooks: [
      { rating: 5, spiciness: 1, saltiness: 3, richness: 5, notes: 'Date night winner.' },
      { rating: 5, spiciness: 1, saltiness: 3, richness: 5 },
    ],
  },
  {
    name: 'Low-and-Slow Beef Chili',
    description: 'Deep, smoky, batch-cookable chili that gets better on day two. Freezes like a champ.',
    timeMinutes: 90, servings: 6, difficulty: 2, daysAgo: 6,
    tags: ['dinner', 'comfort', 'meal-prep', 'high-protein'],
    ingredients: [
      { name: 'ground beef', quantity: 2, unit: 'lb' },
      { name: 'onion', quantity: 1, unit: 'count' },
      { name: 'garlic', quantity: 4, unit: 'clove' },
      { name: 'kidney bean', quantity: 2, unit: 'can' },
      { name: 'black bean', quantity: 1, unit: 'can' },
      { name: 'tomato', quantity: 4, unit: 'count' },
      { name: 'beef stock', quantity: 2, unit: 'cup' },
    ],
    instructions: [
      'Brown the beef hard for color, then add onion and garlic and soften.',
      'Stir in tomatoes, beans, and stock; bring to a simmer.',
      'Cook low for 60–75 minutes until thick. Top however you like.',
    ],
    cooks: [
      { rating: 5, spiciness: 3, saltiness: 3, richness: 4, notes: 'Better the next day, always.' },
      { rating: 4, spiciness: 4, saltiness: 3, richness: 4 },
    ],
  },
  {
    name: 'Coconut Chickpea Curry',
    description: 'A 30-minute pantry curry that tastes like it simmered all day. Vegan and freezer-friendly.',
    timeMinutes: 30, servings: 4, difficulty: 2, daysAgo: 8,
    tags: ['dinner', 'vegan', 'vegetarian', 'meal-prep'],
    ingredients: [
      { name: 'chickpeas', quantity: 2, unit: 'can' },
      { name: 'onion', quantity: 1, unit: 'count' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
      { name: 'tomato', quantity: 3, unit: 'count' },
      { name: 'spinach', quantity: 3, unit: 'cup' },
      { name: 'coconut oil', quantity: 2, unit: 'tbsp' },
      { name: 'brown rice', quantity: 2, unit: 'cup' },
    ],
    instructions: [
      'Soften onion and garlic in coconut oil until fragrant.',
      'Add tomatoes and chickpeas; simmer 15 minutes to meld.',
      'Stir in spinach until wilted and serve over brown rice.',
    ],
    cooks: [
      { rating: 4, spiciness: 3, saltiness: 2, richness: 3, notes: 'Great lunch prep.' },
    ],
  },
  {
    name: 'Spicy Shrimp Tacos',
    description: 'Charred, punchy shrimp in warm tortillas. Twenty minutes from craving to plate.',
    timeMinutes: 20, servings: 3, difficulty: 2, daysAgo: 10,
    tags: ['dinner', 'spicy', 'quick'],
    ingredients: [
      { name: 'shrimp', quantity: 1, unit: 'lb' },
      { name: 'tortilla', quantity: 6, unit: 'count' },
      { name: 'lime', quantity: 2, unit: 'count' },
      { name: 'garlic', quantity: 2, unit: 'clove' },
      { name: 'olive oil', quantity: 2, unit: 'tbsp' },
      { name: 'cabbage', quantity: 2, unit: 'cup' },
    ],
    instructions: [
      'Toss shrimp with garlic, oil, and plenty of chili; sear hot and fast.',
      'Warm the tortillas in a dry pan until pliable and a little blistered.',
      'Build tacos with shrimp, crunchy cabbage, and a hard squeeze of lime.',
    ],
    cooks: [
      { rating: 5, spiciness: 5, saltiness: 3, richness: 2, notes: 'Bring napkins.' },
      { rating: 4, spiciness: 4, saltiness: 3, richness: 2 },
    ],
  },
  {
    name: 'Lemon Herb Pork Chops',
    description: 'Juicy pan-seared chops with a bright lemon-butter finish. Weeknight effort, Sunday flavor.',
    timeMinutes: 25, servings: 4, difficulty: 2, daysAgo: 12,
    tags: ['dinner', 'high-protein', 'low-carb'],
    ingredients: [
      { name: 'pork chop', quantity: 4, unit: 'count' },
      { name: 'butter', quantity: 2, unit: 'tbsp' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
      { name: 'lemon', quantity: 1, unit: 'count' },
      { name: 'olive oil', quantity: 1, unit: 'tbsp' },
    ],
    instructions: [
      'Pat chops dry, season well, and sear in oil until deeply golden.',
      'Add butter and garlic, baste the chops, and finish to temp.',
      'Squeeze lemon over the top and rest before serving.',
    ],
    cooks: [
      { rating: 4, spiciness: 1, saltiness: 3, richness: 4 },
    ],
  },
  {
    name: 'Peanut Tofu Noodles',
    description: 'Crispy tofu tangled in a glossy peanut sauce. The vegetarian dinner meat-eaters steal bites of.',
    timeMinutes: 30, servings: 4, difficulty: 3, daysAgo: 14,
    tags: ['dinner', 'vegetarian', 'comfort'],
    ingredients: [
      { name: 'firm tofu', quantity: 14, unit: 'oz' },
      { name: 'spaghetti', quantity: 12, unit: 'oz' },
      { name: 'peanut butter', quantity: 3, unit: 'tbsp' },
      { name: 'soy sauce', quantity: 3, unit: 'tbsp' },
      { name: 'sesame oil', quantity: 1, unit: 'tbsp' },
      { name: 'garlic', quantity: 2, unit: 'clove' },
    ],
    instructions: [
      'Press and cube tofu, then crisp it in sesame oil on all sides.',
      'Whisk peanut butter, soy, garlic, and a splash of pasta water into a sauce.',
      'Toss cooked noodles and tofu in the sauce until everything is coated.',
    ],
    cooks: [
      { rating: 5, spiciness: 2, saltiness: 4, richness: 4, notes: 'Add chili crisp.' },
      { rating: 4, spiciness: 1, saltiness: 4, richness: 4 },
    ],
  },
  {
    name: 'Turkey Meatballs & Spaghetti',
    description: 'Tender turkey meatballs that prove lean can still mean cozy. A kid-approved classic.',
    timeMinutes: 45, servings: 5, difficulty: 2, daysAgo: 16,
    tags: ['dinner', 'comfort', 'kid-friendly', 'high-protein'],
    ingredients: [
      { name: 'ground turkey', quantity: 1.5, unit: 'lb' },
      { name: 'egg', quantity: 1, unit: 'count' },
      { name: 'parmesan', quantity: 0.5, unit: 'cup' },
      { name: 'tomato', quantity: 5, unit: 'count' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
      { name: 'spaghetti', quantity: 1, unit: 'lb' },
    ],
    instructions: [
      'Mix turkey with egg and parmesan, roll into balls, and brown them.',
      'Simmer crushed tomatoes with garlic, then nestle the meatballs in to finish.',
      'Serve over spaghetti with extra parmesan.',
    ],
    cooks: [
      { rating: 4, spiciness: 1, saltiness: 3, richness: 3, notes: 'Kids cleared their plates.' },
    ],
  },
  {
    name: 'Greek Yogurt Pancakes',
    description: 'Thick, fluffy, protein-packed pancakes that actually keep you full past 10am.',
    timeMinutes: 20, servings: 3, difficulty: 1, daysAgo: 18,
    tags: ['breakfast', 'sweet', 'high-protein', 'kid-friendly'],
    ingredients: [
      { name: 'greek yogurt', quantity: 1, unit: 'cup' },
      { name: 'egg', quantity: 2, unit: 'count' },
      { name: 'flour', quantity: 1, unit: 'cup' },
      { name: 'honey', quantity: 2, unit: 'tbsp' },
      { name: 'butter', quantity: 1, unit: 'tbsp' },
    ],
    instructions: [
      'Whisk yogurt, eggs, and honey, then fold in the flour until just combined.',
      'Cook scoops on a buttered griddle until bubbles set, then flip.',
      'Stack high and finish with a little more honey.',
    ],
    cooks: [
      { rating: 5, spiciness: 1, sweetness: 4, richness: 3, notes: 'Sunday staple.' },
      { rating: 4, spiciness: 1, sweetness: 3, richness: 3 },
    ],
  },
  {
    name: 'Hearty Lentil Soup',
    description: 'A big pot of cozy. Cheap, vegan, and somehow better every day of the week.',
    timeMinutes: 50, servings: 6, difficulty: 1, daysAgo: 21,
    tags: ['soup', 'vegan', 'vegetarian', 'meal-prep', 'comfort'],
    ingredients: [
      { name: 'lentil', quantity: 2, unit: 'cup' },
      { name: 'carrot', quantity: 3, unit: 'count' },
      { name: 'celery', quantity: 3, unit: 'count' },
      { name: 'onion', quantity: 1, unit: 'count' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
      { name: 'vegetable stock', quantity: 6, unit: 'cup' },
    ],
    instructions: [
      'Sweat the carrot, celery, onion, and garlic until soft.',
      'Add lentils and stock, bring to a boil, then simmer 35–40 minutes.',
      'Season hard at the end and blend a little if you like it creamy.',
    ],
    cooks: [
      { rating: 4, spiciness: 1, saltiness: 3, richness: 2, notes: 'Whole week of lunches.' },
    ],
  },
  {
    name: 'Steak & Roasted Sweet Potato',
    description: 'A no-fuss steakhouse plate at home. Big protein, big flavor, one sheet pan of sweet potatoes.',
    timeMinutes: 35, servings: 2, difficulty: 3, daysAgo: 24,
    tags: ['dinner', 'date-night', 'high-protein', 'low-carb'],
    ingredients: [
      { name: 'steak', quantity: 1, unit: 'lb' },
      { name: 'sweet potato', quantity: 2, unit: 'count' },
      { name: 'butter', quantity: 2, unit: 'tbsp' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
      { name: 'olive oil', quantity: 2, unit: 'tbsp' },
    ],
    instructions: [
      'Roast cubed sweet potato in oil until caramelized at the edges.',
      'Sear the steak hard, then baste with butter and garlic to finish.',
      'Rest the steak, slice against the grain, and plate with the potatoes.',
    ],
    cooks: [
      { rating: 5, spiciness: 1, saltiness: 4, richness: 5, notes: 'Better than takeout.' },
    ],
  },
  {
    name: 'Cheesy Breakfast Burrito',
    description: 'The make-ahead breakfast that beats the drive-thru. Wrap, freeze, microwave, win.',
    timeMinutes: 20, servings: 4, difficulty: 1, daysAgo: 27,
    tags: ['breakfast', 'meal-prep', 'high-protein'],
    ingredients: [
      { name: 'egg', quantity: 8, unit: 'count' },
      { name: 'cheddar', quantity: 1, unit: 'cup' },
      { name: 'bacon', quantity: 6, unit: 'slice' },
      { name: 'potato', quantity: 2, unit: 'count' },
      { name: 'tortilla', quantity: 4, unit: 'count' },
    ],
    instructions: [
      'Crisp the bacon and potatoes, then soft-scramble the eggs in the fat.',
      'Pile eggs, potato, bacon, and cheese into warm tortillas.',
      'Roll tight, sear the seam, and eat (or freeze for later).',
    ],
    cooks: [
      { rating: 4, spiciness: 1, saltiness: 4, richness: 4, notes: 'Froze half for the week.' },
    ],
  },
];

function buildRecipe(spec) {
  const now = new Date().toISOString();
  const createdAt = daysAgoISO(spec.daysAgo);
  const ingredients = normalizeIngredients(spec.ingredients);
  const { macros } = computeMacros(spec.ingredients, {
    servings: spec.servings,
    macrosScope: 'per-serving',
  });

  return {
    recipeId: uuidv4(),
    authorUserId: AUTHOR_USER_ID,
    authorHandle: null,
    name: spec.name.trim(),
    description: spec.description || '',
    timeMinutes: Number.isFinite(spec.timeMinutes) ? spec.timeMinutes : 0,
    servings: normalizeServings(spec.servings ?? 1),
    difficulty: normalizeDifficulty(spec.difficulty),
    proteinSource: '',
    proteinTypes: detectProteinTypes(ingredients),
    tags: normalizeTags(spec.tags ?? []),
    ingredients,
    instructions: normalizeInstructions(spec.instructions),
    macros: normalizeMacros(macros),
    macrosScope: normalizeMacrosScope('per-serving'),
    privacy: 'public',
    createdAt,
    updatedAt: now,
    cookCount: 0,
    avgRating: null, ratingCount: 0,
    spicinessAvg: null, spicinessCount: 0,
    sweetnessAvg: null, sweetnessCount: 0,
    saltinessAvg: null, saltinessCount: 0,
    richnessAvg: null, richnessCount: 0,
  };
}

function buildCook(recipeId, cookSpec, cookedAt) {
  const cookId = uuidv4();
  const now = new Date().toISOString();
  const axes = readAxesFromBody(cookSpec);
  const cook = {
    cookId,
    recipeId,
    cookedAt,
    chefs: [AUTHOR_USER_ID],
    diners: [AUTHOR_USER_ID],
    notes: cookSpec.notes || '',
    photoUrl: '',
    rating: axes.rating ?? null,
    spiciness: axes.spiciness ?? null,
    sweetness: axes.sweetness ?? null,
    saltiness: axes.saltiness ?? null,
    richness: axes.richness ?? null,
    loggedByUserId: AUTHOR_USER_ID,
    createdAt: now,
    updatedAt: now,
  };
  const participant = {
    userId: AUTHOR_USER_ID,
    cookedAtCookId: `${cookedAt}#${cookId}`,
    cookId,
    recipeId,
    role: 'chef',
    cookedAt,
  };
  return { cook, participant };
}

async function main() {
  console.log(`Seeding ${LIBRARY.length} recipes as author ${AUTHOR_USER_ID}${DRY_RUN ? ' (DRY RUN)' : ''}\n`);
  let recipeCount = 0;
  let cookCount = 0;

  for (const spec of LIBRARY) {
    const recipe = buildRecipe(spec);
    console.log(
      `• ${recipe.name}  [${recipe.proteinTypes.join(', ') || 'none'}]  ` +
      `${recipe.macros.calories}cal/${recipe.macros.protein}p  ${(spec.cooks || []).length} cooks`
    );

    if (!DRY_RUN) {
      await docClient.send(new PutCommand({ TableName: RECIPES_TABLE, Item: recipe }));
    }
    recipeCount++;

    const cooks = spec.cooks || [];
    for (let i = 0; i < cooks.length; i++) {
      // Stagger cook timestamps after the recipe was created.
      const cookedAt = daysAgoISO(Math.max(0, spec.daysAgo - i - 1), 19);
      const { cook, participant } = buildCook(recipe.recipeId, cooks[i], cookedAt);
      if (!DRY_RUN) {
        await docClient.send(new PutCommand({ TableName: COOKS_TABLE, Item: cook }));
        await docClient.send(new PutCommand({ TableName: COOK_PARTICIPANTS_TABLE, Item: participant }));
      }
      cookCount++;
    }

    if (!DRY_RUN && cooks.length > 0) {
      await recomputeRecipeAggregatesFromCooks(recipe.recipeId);
    }
  }

  console.log(`\nDone. ${recipeCount} recipes, ${cookCount} cooks${DRY_RUN ? ' (nothing written)' : ' written'}.`);
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
