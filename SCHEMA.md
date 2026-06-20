# DynamoDB Schema — Xom Appétit

> Logical table names below. Deployed names are prefixed with `xomappetit-`
> (e.g. `recipes` → `xomappetit-recipes`). Table names reach each Lambda via
> `*_TABLE_NAME` environment variables (Terraform-managed in
> [`xomappetit-infrastructure`](https://github.com/Xomware/meals-infrastructure)).

The data model has two core entities:

- **Recipe** — the durable definition of a dish (ingredients, steps, macros, privacy).
- **Cook** — one logged instance of *making* a recipe, with its own per-axis
  ratings and a chef/diner participant list. Recipe rating aggregates are
  **re-derived from cooks** (see `shared/cook-aggregates.js`), so "what people
  who actually cooked it thought" is the source of truth on a recipe card.

Everything else (likes, comments, friendships, blocks, notifications, reports)
hangs off those two. User identity/profiles live in the shared **xomware-users**
service — these tables only ever store the Cognito `sub` (`userId`).

---

## Recipes & cooking

### `recipes`
| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| recipeId | String | **PK** | uuid |
| authorUserId | String | | Cognito sub of the author |
| authorHandle | String\|null | | denormalized handle (may be null; resolve via users service) |
| name | String | | |
| description | String | | |
| timeMinutes | Number | | |
| servings | Number | | 1–50 |
| difficulty | Number | | 1–5 (legacy `Easy`/`Medium`/`Hard` migrated on read) |
| proteinSource | String | | free-text, legacy/search |
| proteinTypes | List\<String\> | | enum, auto-detected from ingredients |
| tags | List\<String\> | | enum (see `shared/ingredients.js` `TAGS`) |
| ingredients | List\<Map\> | | `{ name, amount, unit }`; `amount`/`unit` may be null |
| instructions | List\<Map\> | | `{ text, ingredientIndexes[] }` ordered steps |
| macros | Map | | `{ calories, protein, carbs, fat }` |
| macrosScope | String | | `per-recipe` \| `per-serving` |
| privacy | String | | `public` \| `friends` \| `private` |
| cookCount | Number | | derived from cooks |
| avgRating / ratingCount | Number\|null / Number | | derived from cooks |
| spicinessAvg / spicinessCount | Number\|null / Number | | derived from cooks |
| sweetnessAvg / sweetnessCount | Number\|null / Number | | derived from cooks |
| saltinessAvg / saltinessCount | Number\|null / Number | | derived from cooks |
| richnessAvg / richnessCount | Number\|null / Number | | derived from cooks |
| createdAt / updatedAt | String | | ISO 8601 |

**GSI `author-index`** — PK `authorUserId`, SK `createdAt`. Lists one author's
recipes newest-first (used by `/recipes/list` and the friends feed).

> **Back-compat:** legacy ingredients were `List<String>`; legacy `quantity` is
> read as `amount`. Normalizers in `shared/ingredients.js` coerce on read; new
> writes always use the structured shape.

### `cooks`
| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| cookId | String | **PK** | uuid |
| recipeId | String | | |
| cookedAt | String | | ISO 8601 (caller-supplied or now) |
| chefs | List\<String\> | | userIds who cooked it (caller by default) |
| diners | List\<String\> | | userIds who ate it |
| notes | String | | |
| photoUrl | String | | |
| rating / spiciness / sweetness / saltiness / richness | Number\|null | | each 1–5 |
| loggedByUserId | String | | who recorded the cook |
| createdAt / updatedAt | String | | ISO 8601 |

**GSI `recipe-index`** — PK `recipeId`, SK `cookedAt`. All cooks of a recipe;
powers aggregate recompute and the recipe's cook history.

### `cook-participants`
One row per (user, cook) — the join that answers "what has this user cooked?".
| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| userId | String | **PK** | participant |
| cookedAtCookId | String | **SK** | `${cookedAt}#${cookId}` (sorts by recency) |
| cookId | String | | |
| recipeId | String | | |
| role | String | | `chef` \| `diner` (chef wins on dedupe) |
| cookedAt | String | | ISO 8601 |

---

## Social engagement

### `recipe-ratings`
Direct per-user rating of a recipe (distinct from cook-derived aggregates).
PK `recipeId`, SK `userId`. Attrs: `rating`, `spiciness`, `sweetness`,
`saltiness`, `richness` (each 1–5), `ratedAt`.

### `recipe-likes`
PK `recipeId`, SK `userId`. Attrs: `createdAt`. Like is a toggle; `likeCount`
is computed by querying this partition.

### `recipe-comments`
PK `recipeId`, SK `commentId` (uuid). Attrs: `userId`, `text` (≤2000), `createdAt`.
Per-recipe thread, listed oldest-first.

### `cook-comments`
PK `cookId`, SK `commentId` (uuid). Attrs: `userId`, `text` (≤2000), `createdAt`.
Per-cook thread; visibility mirrors the parent recipe's privacy.

---

## Graph & messaging

### `friendships`
Two rows per friendship (one each direction) so either side can query its own
partition.
| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| userId | String | **PK** | owner of this row |
| friendUserId | String | **SK** | the other person |
| status | String | | `pending` \| `accepted` |
| createdAt | String | | request time |
| acceptedAt | String | | set when accepted |

**GSI `friend-index`** — PK `friendUserId`, SK `userId`. Lets a user find
incoming requests (rows where they are the *target*).

### `blocks`
PK `userId`, SK `blockedUserId`. Attrs: `blockedAt`. Blocking also tears down any
existing friendship in both directions. Block lists filter the public feed,
search, and friend feed (`shared/blocks.js`).

### `notifications`
PK `userId` (recipient), SK `sortKey` = `${createdAt}#${notifId}` (newest-first).
| Attribute | Type | Notes |
|-----------|------|-------|
| notifId | String | uuid |
| type | String | `friend_request` \| `friend_accept` \| `recipe_liked` \| `comment_added` |
| actorUserId | String | who triggered it |
| refType / refId | String | `recipe` \| `cook` \| `friend` + target id |
| meta | Map | optional context |
| read | Boolean | |
| createdAt | String | ISO 8601 |
| ttl | Number | epoch seconds; expires after `NOTIFICATIONS_RETENTION_DAYS` (default 90) |

Writes are best-effort (`shared/notifications.js` never throws into the caller),
and self-notifications are suppressed.

### `reports`
PK `userId` (reporter), SK `sortKey` = `${createdAt}#${reportId}`. Attrs:
`refType` (`user`\|`recipe`\|`cook`\|`comment`), `refId`, `reason` (≤500),
`createdAt`, `ttl` (90-day expiry). Write-only in v1 — moderation UI is future work.
