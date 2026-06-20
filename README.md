# Xom Appétit — Backend API

Serverless backend for **Xom Appétit**, a social home-cooking tracker — recipes,
logged cook sessions, multi-axis ratings, friends, a social feed, and AI recipe
import. Built with AWS Lambda, API Gateway, and DynamoDB.

## Architecture

- **Runtime:** Node.js 20.x (CommonJS)
- **Database:** DynamoDB — 11 tables prefixed `xomappetit-` (see [SCHEMA.md](./SCHEMA.md))
- **Auth:** Cognito-issued JWT in `Authorization: Bearer <token>`, validated by
  API Gateway's `COGNITO_USER_POOLS` authorizer against the shared
  **xomware-users** pool. Every route requires auth.
- **AI:** Anthropic API (Claude) for recipe extraction from text/URL, plus a
  static nutrition table for macro estimation (no LLM needed for macros).
- **API host:** `https://api.xomappetit.xomware.com`
- **Frontend:** [`xomappetit-frontend`](https://github.com/Xomware/meals-frontend) (Next.js, S3 + CloudFront at `xomappetit.xomware.com`)
- **Infrastructure:** [`xomappetit-infrastructure`](https://github.com/Xomware/meals-infrastructure) (Terraform)

## API style

Flat verb-style routes under a service prefix (`/recipes/*`, `/cooks/*`,
`/friends/*`, `/notifications/*`, `/blocks/*`, `/reports/*`). **All routes are
`POST`** and resource IDs travel in the **request body**, not the path. This
matches the shared `api-gateway-service` Terraform module used across Xomware apps.

User identity is never sent in bodies — the caller is always the JWT `sub`.
Profiles/handles are resolved separately via the shared xomware-users service;
these functions store only `userId`s.

## Project structure

```
functions/                 # one dir per Lambda → one POST route
  recipes-*/index.js       # /recipes/* (create, get, list, list-public, search,
                           #   edit, delete, rate, like, comment-*, import-*, compute-macros)
  cooks-*/index.js         # /cooks/*   (log, get, list, edit, delete, comment-*)
  friends-*/index.js       # /friends/* (add, respond, remove, list, feed)
  notifications-*/index.js # /notifications/* (list, mark-read)
  blocks-*/index.js        # /blocks/*  (add, remove, list)
  reports-add/index.js     # /reports/add
shared/                    # shared helpers (pure logic + DynamoDB I/O)
  auth.js                  # getUserId / getGroups / isAdmin from JWT claims
  dynamo.js                # DynamoDB DocumentClient singleton
  response.js              # CORS response helpers (ok/created/badRequest/...)
  ingredients.js           # ingredient/recipe normalizers + enums (TAGS, UNITS, ...)
  nutrition.js             # static nutrition table + unit→grams conversion
  macros-calc.js           # computeMacros from ingredients
  protein-detect.js        # infer proteinTypes from ingredient names
  cook-aggregates.js       # re-derive recipe rating aggregates from cooks
  recipe-draft.js          # LLM draft schema + sanitization (imports)
  recipe-jsonld.js         # schema.org/Recipe extraction from HTML (URL import)
  anthropic.js             # Claude API client
  blocks.js / friendships.js / notifications.js  # graph + messaging helpers
scripts/
  seed-starter-library.js  # seed a starter recipe library into the live tables
test/                      # node:test unit tests for the shared modules
```

## API reference

All endpoints: `POST`, JSON body, `Authorization: Bearer <jwt>` required.
IDs accept either `id` or the resource-specific key (e.g. `recipeId`).

### Recipes — `/recipes/*`
| Route | Purpose | Key body fields | Success |
|-------|---------|-----------------|---------|
| `/create` | Create a recipe | `name`* , `ingredients`, `instructions`, `privacy` (`public`\|`friends`\|`private`, default `public`), `tags`, `servings`, `difficulty`, `macros`, `macrosScope` | `201` recipe |
| `/get` | Fetch one recipe (+`likedByMe`) | `recipeId`* | `200` recipe |
| `/list` | List a user's recipes (privacy-filtered) | `authorUserId` (default = caller) | `200` recipe[] |
| `/list-public` | Public feed, newest-first, paginated | `limit`, `cursor`, `tags` (ALL), `proteinTypes` (ANY), `maxTimeMinutes` | `200` `{items, nextCursor}` |
| `/search` | Search public recipes by name/protein | `q`* (≥2 chars), `limit` | `200` `{items}` |
| `/edit` | Update a recipe (author only) | `recipeId`* + editable fields | `200` recipe |
| `/delete` | Delete a recipe (author only) | `recipeId`* | `204` |
| `/rate` | Per-user rating on 5 axes | `recipeId`* + any of `rating`/`spiciness`/`sweetness`/`saltiness`/`richness` (1–5) | `200` ratings + aggregates |
| `/like` | Toggle like | `recipeId`* | `200` `{likeCount, likedByMe}` |
| `/comment-add` | Comment on a recipe | `recipeId`*, `text`* (≤2000) | `201` comment |
| `/comments-list` | List comments (oldest-first) | `recipeId`* | `200` comment[] |
| `/comment-delete` | Delete comment (author or recipe author) | `recipeId`*, `commentId`* | `204` |
| `/import-url` | Extract a draft from a recipe URL | `url`* | `200` `{draft, source}` |
| `/import-text` | Extract a draft from pasted text | `text`* (≥30 chars) | `200` `{draft, source}` |
| `/compute-macros` | Macro calculator (no save) | `ingredients`*, `servings`, `macrosScope` | `200` `{macros, coverage}` |

Privacy gate (`get`/`like`/`rate`/`comment*`): `public` = any caller, `friends`
= author + accepted friends, `private` = author only → `403` otherwise.
Import endpoints try schema.org JSON-LD first, then fall back to Claude.

### Cooks — `/cooks/*`
| Route | Purpose | Key body fields | Success |
|-------|---------|-----------------|---------|
| `/log` | Log a cook session | `recipeId`*, `chefs`, `diners`, `notes`, `photoUrl`, axes (1–5), `cookedAt` | `201` cook |
| `/get` | Fetch one cook | `cookId`* | `200` cook |
| `/list` | List cooks (`scope: 'mine'`\|`'recipe'`) | `scope`, `recipeId` (if recipe) | `200` cook[] |
| `/edit` | Edit a cook (chef only) | `cookId`* + `notes`/`photoUrl`/axes | `200` cook |
| `/delete` | Delete a cook (chef only) | `cookId`* | `204` |
| `/comment-add` | Comment on a cook | `cookId`*, `text`* (≤2000) | `201` comment |
| `/comments-list` | List cook comments | `cookId`* | `200` comment[] |
| `/comment-delete` | Delete cook comment (author or chef) | `cookId`*, `commentId`* | `204` |

Logging a cook writes the cook row + a `cook-participants` row per chef/diner,
then **recomputes the recipe's rating aggregates and `cookCount` from all its
cooks** (`shared/cook-aggregates.js`).

### Friends — `/friends/*`
| Route | Purpose | Key body fields | Success |
|-------|---------|-----------------|---------|
| `/add` | Send / auto-accept request | `friendUserId`* | `200` `{status}` |
| `/respond` | Accept/decline incoming | `friendUserId`*, `action` (`accept`\|`decline`) | `200` `{status}` |
| `/remove` | Cancel request / unfriend (idempotent) | `friendUserId`* | `200` `{status:'removed'}` |
| `/list` | Friends + incoming/outgoing pending | — | `200` `{friends, incomingPending, outgoingPending}` |
| `/feed` | Mixed recipe+cook activity feed | `limit` | `200` `{items, friendCount}` |

If both sides request each other, `/add` auto-accepts (mutual). The feed
interleaves friends' recipes and chef-cooks newest-first, privacy- and block-filtered.

### Notifications · Blocks · Reports
| Route | Purpose | Key body fields | Success |
|-------|---------|-----------------|---------|
| `/notifications/list` | List notifications (newest-first) | `limit`, `cursor` | `200` `{items, nextCursor, unreadInPage}` |
| `/notifications/mark-read` | Mark one / all read | `sortKey` or `all: true` | `200` `{updated}` |
| `/blocks/add` | Block a user (tears down friendship) | `blockedUserId`* | `200` `{status:'blocked'}` |
| `/blocks/remove` | Unblock | `blockedUserId`* | `200` `{status:'unblocked'}` |
| `/blocks/list` | List blocked users | — | `200` `{blocked}` |
| `/reports/add` | Report content (write-only, 90-day TTL) | `refType` (`user`\|`recipe`\|`cook`\|`comment`), `refId`*, `reason` (≤500) | `200` `{status:'received'}` |

\* = required.

## Authentication

Every endpoint requires a Cognito JWT in `Authorization: Bearer <token>` from the
shared **xomware-users** pool (owned by `xomware-infrastructure`). `shared/auth.js`
reads `event.requestContext.authorizer.claims.sub` — the Cognito `sub` UUID is the
`userId` used throughout. Admin actions check `cognito:groups`.

## Development

```bash
npm install
npm test          # node:test unit tests for shared/ modules
```

CI (`.github/workflows/ci.yml`) runs the test suite + a Lambda bundle dry-run on
every PR. Merges to `main` deploy via `.github/workflows/deploy.yml`, which
auto-discovers `functions/*` and ships each as `xomappetit-<group>-<action>`.

### Seeding a starter library

```bash
AWS_REGION=us-east-1 \
RECIPES_TABLE_NAME=xomappetit-recipes \
COOKS_TABLE_NAME=xomappetit-cooks \
COOK_PARTICIPANTS_TABLE_NAME=xomappetit-cook-participants \
AUTHOR_USER_ID=<cognito-sub> \
node scripts/seed-starter-library.js [--dry-run]
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for deploy details and [SCHEMA.md](./SCHEMA.md)
for the full data model.
