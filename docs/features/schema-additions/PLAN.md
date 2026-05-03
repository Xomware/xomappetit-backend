# F2 — Schema Additions: instructions, structured ingredients, comments

**Status:** Ready
**Owner:** Dominick
**Parent epic:** `docs/features/xom-appetite-rollout/PLAN.md`

## Goal

Make the meals schema actually useful for cooking: add ordered instructions, structured ingredients (with quantities/units), and per-meal comments. Keep backward compatibility with existing data (single-user, but data is real).

## Scope

### In scope
- Backend Lambda code changes for new fields and endpoints
- New DynamoDB table for comments (Terraform plan only — no apply)
- Frontend types + API client methods for new endpoints
- SCHEMA.md and README.md updates

### Out of scope (separate work)
- Frontend UI redesign for the new fields (forms, displays) — needs visual design pass
- Any rename to `xom-appetite-*` (that's F3)
- Any AWS / Terraform apply (Dominick approves stage by stage)
- Cook-session logging (decided: per-meal global comments are enough for v1)

## Schema changes

### `meals` table (existing)

| Field | Old | New | Notes |
|---|---|---|---|
| `ingredients` | `List<String>` | `List<Map<{name, quantity, unit}>>` | Backward-compat: read-side normalizes legacy strings → `{name: "...", quantity: null, unit: null}`. Write-side always uses new shape. |
| `instructions` | — | `List<String>` | Ordered cooking steps. Optional. |

### `meal-comments` table (new)

| Attribute | Type | Key |
|---|---|---|
| `mealId` | String | Partition Key |
| `commentId` | String (uuid) | Sort Key |
| `userId` | String | (for authz) |
| `body` | String | |
| `createdAt` | String | ISO 8601 |

No GSI needed for v1 (always query by `mealId`).

## API changes

| Method | Path | Lambda | New? |
|---|---|---|---|
| POST | `/meals` | `meals-create` | Updated — accepts `instructions`, structured ingredients |
| GET | `/meals` | `meals-list` | Updated — normalizes legacy ingredients on read |
| GET | `/meals/{id}` | `meals-get` | Updated — same normalization |
| **PATCH** | **`/meals/{id}`** | **`meals-edit` (NEW)** | General field update (name, ingredients, instructions, macros, etc.) — needed so user can backfill instructions on existing meals |
| PATCH | `/meals/{id}/toggle-cooked` | `meals-update` | Unchanged |
| POST | `/meals/{id}/comments` | `meals-comment-add` (NEW) | Add a comment |
| GET | `/meals/{id}/comments` | `meals-comments-list` (NEW) | List comments for a meal |
| DELETE | `/meals/{id}/comments/{commentId}` | `meals-comment-delete` (NEW) | Delete one comment |

## Implementation order

1. **Backend code** in this repo (no infra deploy yet):
   - Update `meals-create` to accept `instructions` + structured ingredients
   - Add `shared/ingredients.js` for legacy normalization
   - Update `meals-list`, `meals-get` to normalize on read
   - Create `functions/meals-edit/index.js`
   - Create `functions/meals-comment-add/index.js`
   - Create `functions/meals-comments-list/index.js`
   - Create `functions/meals-comment-delete/index.js`
   - Update `deploy.yml` FUNCTIONS array
   - Update SCHEMA.md and README.md
2. **Infra plan** (write Terraform diff, do not apply):
   - 4 new Lambda resources (meals-edit, meals-comment-add, meals-comments-list, meals-comment-delete)
   - 1 new DynamoDB table (`meal-comments`)
   - 4 new API Gateway routes
   - IAM updates so existing role can read/write new table
3. **Frontend** (`meals-frontend`):
   - Update `src/types.ts` for new Meal shape + Comment type
   - Update `src/lib/storage.ts` with new API methods
   - Update `src/lib/hooks.ts` with comment SWR hooks
   - **Stop short of UI components** — that's a design pass for later

## Risks

- **Ingredients shape change** is the main migration risk. Mitigated by read-side normalization (no data backfill needed). Single-user app — even a worst-case re-entry of ~dozens of meals is recoverable.
- **New endpoints will 404 until infra lands.** Frontend code will reference them, but UI shouldn't ship until infra deploys. Acceptable since UI is out of scope here.
- **`meals-edit` is a generic PATCH** — must validate which fields are settable to avoid accidentally clobbering `userId`, `createdAt`, `mealId`, or `id`.

## Done when

- [ ] Backend code changes committed and PR open against `meals-backend`
- [ ] Infra Terraform diff drafted in `meals-infrastructure` (not applied)
- [ ] Frontend types + API client committed and PR open against `meals-frontend`
- [ ] SCHEMA.md and README.md reflect new schema and endpoints
- [ ] Build/lint passes locally for all affected repos
