# F3 — Rename meals-* to xom-appetite-*

**Status:** Draft (do not execute without explicit per-stage approval)
**Owner:** Dominick
**Parent epic:** `docs/features/xom-appetite-rollout/PLAN.md`

> Highest blast radius in the rollout. Touches 3 GitHub repos, AWS Lambdas, DynamoDB tables, IAM, GitHub Actions secrets, and every local clone. Each stage below has explicit "approve to proceed" gates.

## Why this is dangerous

- **GitHub repo rename** changes the URL of every clone, breaks branch refs in unmerged PRs across forks, and can break GitHub Actions OIDC trust policies that scope on `repo:Xomware/meals-backend:*`.
- **Lambda function name change** is not in-place — it's destroy + create. API Gateway integration ARNs change. Old function names retained in CloudWatch logs forever.
- **DynamoDB has no rename.** Must create new tables and migrate data. Single-user app means manageable, but still real work.
- **GitHub Actions secrets** scoped to specific function/role names need updates. `AWS_ROLE_ARN` may have a trust policy that references the repo by name.

## Pre-flight

Run before starting any stage:

```bash
# Inventory current resources
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `meals-`)].FunctionName' --output table
aws dynamodb list-tables --query 'TableNames[?starts_with(@, `meals`)]' --output table
aws apigateway get-rest-apis --query 'items[?starts_with(name, `meals`)].{name:name,id:id}' --output table

# Backup data (single-user — small, fast)
aws dynamodb scan --table-name meals --output json > /tmp/meals-backup.json
aws dynamodb scan --table-name meal-ratings --output json > /tmp/meal-ratings-backup.json
# Add meal-comments after F2 deploys

# Inspect the IAM role used by GitHub Actions deploy.yml
aws iam get-role --role-name <name from AWS_ROLE_ARN>
aws iam get-role-policy --role-name <name> --policy-name <name>
```

## Stage A — AWS resources (run in `meals-infrastructure`)

**Approve gate:** confirm preflight inventory matches expectations and backup files exist.

### A1. Update `terraform/variables.tf`

```hcl
variable "app_name" {
  default = "xom-appetite"   # was "meals"
}
```

This is the lever for everything: lambda names, table names, IAM role name, KMS alias, log groups, all derive from `var.app_name`.

### A2. `terraform plan` — expected diff

- **6 destroys** (or however many `meals-*` lambdas are live), **+12 creates** (renamed lambdas — F2 adds 4)
- **2 destroys / 3 creates** for DynamoDB tables (`meals` → `xom-appetite`, `meal-ratings` → `xom-appetite-ratings`, plus new `xom-appetite-meal-comments`)
- **1 destroy / 1 create** IAM role (`meals-lambda-exec` → `xom-appetite-lambda-exec`)
- **1 destroy / 1 create** KMS alias
- **API Gateway:** rest_api will be replaced (new name) — **this is disruptive**, the API ID changes, and any client referencing the API by ID (CloudFront origins, etc.) breaks. Custom domain `api.xomware.com` is detached and reattached.

### A3. ⚠️ DynamoDB cutover — manual, careful

Terraform will destroy old tables and create new ones, **deleting all data**. To preserve data:

1. **Before apply:** create new tables manually (or via a temporary parallel resource block):
   ```bash
   aws dynamodb create-table --table-name xom-appetite \
     --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=mealId,AttributeType=S \
     --key-schema AttributeName=userId,KeyType=HASH AttributeName=mealId,KeyType=RANGE \
     --billing-mode PAY_PER_REQUEST
   # Repeat for xom-appetite-ratings and xom-appetite-meal-comments
   ```
2. **Migrate data:**
   ```bash
   # Single-user, so probably <100 items per table — write a small Node script using batch-write-item
   ```
3. **Adopt into Terraform state** (`terraform import`) so the new tables are managed and won't be recreated:
   ```bash
   terraform import aws_dynamodb_table.meals 'xom-appetite'
   terraform import aws_dynamodb_table.meal_ratings 'xom-appetite-ratings'
   terraform import aws_dynamodb_table.meal_comments 'xom-appetite-meal-comments'
   ```
4. **Then run `terraform apply`** — the table resources show "no change" if imported correctly.
5. **After apply succeeds:** delete the old `meals` and `meal-ratings` tables manually:
   ```bash
   aws dynamodb delete-table --table-name meals
   aws dynamodb delete-table --table-name meal-ratings
   ```

### A4. API Gateway custom domain reattachment

After `terraform apply`, verify `api.xomware.com` resolves and serves the new API:
```bash
curl -i https://api.xomware.com/meals -H "X-Auth-Hash: ..."
```

If broken: the custom domain mapping needs reattachment. The Terraform module v2.2.0 should handle this automatically; if not, manual fix via `aws apigateway update-domain-name --base-path-mapping`.

**Approve gate:** all endpoints respond with 200 (old data, new lambda names).

## Stage B — Repository renames

**Approve gate:** Stage A green and stable for at least 24 hours.

### B1. Rename GitHub repos

```bash
gh repo rename xom-appetite-backend --repo Xomware/meals-backend
gh repo rename xom-appetite-frontend --repo Xomware/meals-frontend
gh repo rename xom-appetite-infrastructure --repo Xomware/meals-infrastructure
```

GitHub auto-redirects old URLs (forever, as long as no new repo claims the old name). Open PRs preserve their numbers.

### B2. Update OIDC trust policy (if scoped by repo name)

Check `AWS_ROLE_ARN` trust policy:
```bash
aws iam get-role --role-name <role-from-arn>
```

If trust policy has `token.actions.githubusercontent.com:sub` conditions like `repo:Xomware/meals-backend:*`, update to `repo:Xomware/xom-appetite-backend:*`. Without this, deploy.yml will fail to assume the role.

### B3. Update local clones

```bash
cd /Users/dom/Code/meals-backend       && git remote set-url origin https://github.com/Xomware/xom-appetite-backend.git
cd /Users/dom/Code/meals-frontend      && git remote set-url origin https://github.com/Xomware/xom-appetite-frontend.git
cd /Users/dom/Code/meals-infrastructure && git remote set-url origin https://github.com/Xomware/xom-appetite-infrastructure.git
```

Then optionally rename the local directories — out of scope for this plan, separate housekeeping.

### B4. Update `xomware-frontend` reportTargets

Change in `landing.component.ts`:
```diff
- { label: 'Xom Appetite', repo: 'Xomware/meals-frontend' },
+ { label: 'Xom Appetite', repo: 'Xomware/xom-appetite-frontend' },
```

## Stage C — Internal references

**Approve gate:** Stage B complete and deploys verified.

### C1. `meals-backend` (now `xom-appetite-backend`)

- `.github/workflows/deploy.yml`: `APP_NAME: meals` → `APP_NAME: xom-appetite`. Already drives the lambda name (`${APP_NAME}-${fn_name}`), so the FUNCTIONS array's prefix becomes correct without further change.
- `README.md`: replace "Meals Backend" / "meals tracking" with "Xom Appetite"
- `DEPLOYMENT.md`: same
- `package.json` name, if any
- Lambda function directory names: leave as `meals-create`, `meals-edit` etc. — they're internal labels. The deployed lambda name is `${APP_NAME}-${fn_name}` = `xom-appetite-meals-create`. **Decision needed:** strip the redundant `meals-` from directory names too?
  - Recommend: yes — rename `functions/meals-*` to `functions/*` (drop the prefix). Update `deploy.yml` FUNCTIONS array. Cleaner.

### C2. `meals-frontend` (now `xom-appetite-frontend`)

- `package.json` name → `xom-appetite-frontend`
- README — title and description
- (Visual rebrand — separate F5 work)

### C3. `meals-infrastructure` (now `xom-appetite-infrastructure`)

- `terraform/variables.tf` — already changed in Stage A
- README — title and description
- `domain_suffix` variable already produces `xomware.com` — `local.domain_name` becomes `xom-appetite.xomware.com` automatically. **This is the F4 subdomain — needs reconciliation with whatever F4 chooses.**

## Stage D — Drop the old

**Approve gate:** Stage C green for 24h+, no errors in CloudWatch logs.

- Delete old DynamoDB tables (`meals`, `meal-ratings`) — done in A3.
- Delete old CloudWatch log groups (`/aws/lambda/meals-*`)
- Remove the GitHub redirect dependency by waiting 30 days, or accept it indefinitely.

## Risks & rollback

| Risk | Severity | Mitigation |
|---|---|---|
| Data loss on table cutover | Critical | Manual import-then-apply pattern in A3, plus backup files in preflight |
| OIDC trust policy breaks deploys | High | Verify and update in B2 before the next push to main |
| API Gateway ID change breaks dependent clients | Medium | Custom domain `api.xomware.com` insulates; verify with curl |
| In-flight PRs become unmergeable | Medium | Merge or close all open PRs before B1 |
| Long-running git clones break | Low | `git remote set-url` fixes locally; GitHub auto-redirects HTTPS clones |

## Decisions still needed

1. **Strip the `meals-` prefix from internal lambda directory names?** (Recommend yes — see C1)
2. **Schedule:** rename in one session, or split A / B / C across multiple days?
3. **Old data preservation:** keep backup files for how long?

## Done when

- [ ] All three repos renamed on GitHub
- [ ] All AWS resources are `xom-appetite-*`
- [ ] Old `meals` and `meal-ratings` tables deleted, data migrated
- [ ] Deploy workflows green on the renamed repos
- [ ] xomware-frontend reportTargets updated
- [ ] `api.xomware.com/meals` returns 200 OK with existing data
