# Xom Appetite — Full Rollout (Epic Plan)

**Status:** Draft
**Owner:** Dominick
**Created:** 2026-05-02

> Take the meals app from "deployed-but-anonymous backend + unshipped frontend + no brand" to "Xom Appetite, live on xomware.com, with the new schema features." This is an epic — see decomposition below for the per-feature plans.

---

## Goal

Land **Xom Appetite** as a fully-branded, deployed, discoverable Xomware product on xomware.com, with the schema additions Dominick called for: structured ingredients, cooking instructions, ratings, comments.

## Naming decision (locked)

See `/docs/features/meals-naming/BRAINSTORM.md` for full brainstorm. Final:

- Display: `Xom Appetite`
- Repos: `xom-appetite-backend`, `xom-appetite-frontend`, `xom-appetite-infrastructure`
- Subdomain: `xomappetite.xomware.com`
- Lambda prefix: `xom-appetite-*`
- DynamoDB tables: `xom-appetite`, `xom-appetite-ratings`, `xom-appetite-comments`
- Mascot roster: Xom Fieri, Xom Boyardee, Xomdon Ramsay (roles TBD, logo TBD by Dominick)

## Current state (snapshot, 2026-05-02)

| Surface | State |
|---|---|
| Backend | Deployed: 8 Lambdas (`meals-*`) in `us-east-1`, fronted by API Gateway at `api.xomware.com`, DynamoDB tables `meals` + `meal-ratings` |
| Frontend (`meals-frontend`) | Next.js 15 + Tailwind, **not deployed** anywhere |
| xomware.com card | **Done locally** — added in `xomware-frontend/src/app/components/landing/landing.component.ts` with placeholder SVG. Pending commit/push. |
| Subdomain | `xomappetite.xomware.com` does not exist (no Route53 record, no ACM cert, no CloudFront distribution) |
| Logo | Placeholder SVG (chef hat in coral, crossed knife/fork X behind). Real logo: deferred to Dominick |
| Schema | Current shape supports flat ingredients (`List<String>`), no instructions, comments only via single `notes` string on rating |

## Decomposition (5 features)

Ordered by blast radius (ascending). Each gets its own `PLAN.md` via `/plan` or `/orchestrate`.

### F1: xomware.com card (live) — **smallest, mostly done**

**State:** Local edits done. Build passes.
**Touches:** `xomware-frontend` only.
**Steps remaining:**
1. Review diff (also has unrelated `monster.component.ts` change in the working tree — keep separate)
2. Commit just the Xom Appetite card files
3. Push to `master` → triggers `deploy-frontend.yml` → S3 + CloudFront invalidation
4. Verify card renders on production site

**Risks:** Low. Card status is `coming-soon`, URL points to `xomappetite.xomware.com` which doesn't exist yet — clicking the card lands on a broken page. **Mitigation:** keep `coming-soon` until F4 lands.

**Files (already changed):**
- `xomware-frontend/src/app/components/landing/landing.component.ts` (apps[] + reportTargets[])
- `xomware-frontend/src/assets/img/xom-appetite-placeholder.svg` (new)

---

### F2: Schema additions (single repo, no rename) — **next**

**Touches:** `meals-backend` (this repo) + `meals-frontend`.
**Why before rename:** Smaller blast radius. Renaming on top of in-progress schema changes multiplies the pain.

**Schema changes:**
1. `ingredients` field migrates from `List<String>` to `List<Map<{name, quantity, unit}>>`
   - Backwards-compat read: lambdas detect string-vs-map per item, normalize on read, write only the new shape
   - New shape persisted on next write (PATCH/POST)
2. `instructions: List<String>` added — ordered cooking steps
3. New DynamoDB table `meal-comments` (will be `xom-appetite-comments` post-rename)
   - PK: `mealId`, SK: `commentId` (uuid)
   - Attrs: `userId`, `body` (string), `createdAt`
   - 2 new lambdas: `meals-comment-add`, `meals-comments-list`
4. Update `meals-create` and `meals-update` to accept `instructions` + structured ingredients
5. Update SCHEMA.md
6. Frontend: add fields to types, forms, display

**Infra change required:** New DynamoDB table → Terraform change in `meals-infrastructure`.

**Risks:** Existing data has `List<String>` ingredients. Don't migrate, just dual-read.

**Open questions:**
- Should comments be per-cook-session (linked to a specific cook) or per-meal globally?
- Are `notes` on a rating still kept, or replaced by comments?

---

### F3: Rename `meals-*` → `xom-appetite-*` — **biggest blast radius**

**Touches:** All 3 repos + AWS infra + GitHub + GitHub Actions secrets.
**Why last (after F1, F2):** Once renamed, the schema work and the card are both "Xom Appetite" coherently. Renaming early creates a confusing intermediate state.

**Stages:**

**Stage A — Backend repo + Lambdas + tables (atomic via Terraform)**
1. New Terraform plan in `meals-infrastructure`:
   - New Lambdas `xom-appetite-*` (alongside `meals-*` initially? or rename in place?)
   - DynamoDB `xom-appetite` and `xom-appetite-ratings` (created fresh — no rename support)
   - **Data migration:** scan + put-item from old → new tables. Single-user, so manageable.
2. Update `deploy.yml` lambda name list
3. Update env var names (`MEALS_TABLE_NAME` → `APPETITE_TABLE_NAME`)
4. Cutover: API Gateway routes flip to new lambdas, DNS unchanged (`api.xomware.com` still serves)
5. Decommission `meals-*` lambdas + tables once verified

**Stage B — Repo renames**
1. `gh repo rename` for `meals-backend` → `xom-appetite-backend`
2. Same for `meals-frontend`, `meals-infrastructure`
3. Update GitHub Actions secret references (e.g. `LAMBDA_BUCKET` may stay; `AWS_ROLE_ARN` IAM trust policy may need scope updates)
4. Update local clones (`git remote set-url`)
5. Update reportTargets[] in `xomware-frontend` to point to new repo names

**Stage C — Update README, SCHEMA, all docs**

**Risks:** Highest of all features.
- IAM trust policies often scoped to repo paths — rename can break `assume-role-with-web-identity`
- Anyone with a clone or branch ref breaks
- DynamoDB has no rename — table cutover is the riskiest step. **Single-user** mitigates this significantly.

---

### F4: Deploy `xom-appetite-frontend` + provision `xomappetite.xomware.com`

**Touches:** `xom-appetite-frontend` (post-rename) + `xomware-infrastructure` (Route53, ACM, CloudFront).

**Decisions needed:**
- **Hosting target:** S3 + CloudFront (like `xomware-frontend`) or Vercel (Next.js native)? Vercel is dramatically less work for a Next.js app, but introduces a non-AWS dependency in the stack. Recommend Vercel for personal app.
- If Vercel: connect repo, set env vars (`NEXT_PUBLIC_API_URL=https://api.xomware.com`), point `xomappetite.xomware.com` CNAME at Vercel. Done.
- If S3+CF: copy `xomware-infrastructure` Terraform module, new bucket + distribution + ACM cert + Route53 record. Workflow file mirrors `deploy-frontend.yml`.

**Risks:** ACM cert in `us-east-1` is required for CloudFront — already standard for this org.

---

### F5: Logo + final polish

**Owner:** Dominick.
**Blocks:** Nothing — placeholder SVG is acceptable for `coming-soon` state.
**Trigger:** Once Dominick lands the real logo, replace `xom-appetite-placeholder.svg` with the real asset, flip card status to `live`, delete `placeholder` from filename.

---

## Suggested execution order

```
F1 (card, coming-soon) — commit + push now (you decide)
F2 (schema additions) — single-repo plan, low risk, immediate user value
F3 (rename) — coordinated cutover, separate session, careful
F4 (deploy + DNS) — depends on F3 if we want correct repo name in CI
F5 (real logo) — anytime; flips card to live
```

## What I will NOT do without explicit approval

- `git push` to any repo (especially `xomware-frontend` master, which auto-deploys)
- `gh repo rename` (irreversible UX-wise, breaks every clone)
- Any `terraform apply` in `meals-infrastructure` or `xomware-infrastructure`
- Drop / recreate any DynamoDB table
- Change any IAM role or GitHub Actions secret

## Decisions needed from Dominick to unblock

1. **Push the F1 changes now?** (Will deploy the card to xomware.com production with `coming-soon` status, broken click-through.)
2. **Hosting target for F4:** Vercel or S3+CloudFront?
3. **F2 schema decisions:**
   a. Comments model: per-meal global, or per-cook-session?
   b. Keep `notes` on ratings, or fold into comments?
4. **Order:** F2 before F3 (current recommendation), or rename first because you hate seeing "meals-*" everywhere?
