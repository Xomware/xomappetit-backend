# Deployment Guide — Xom Appétit Backend

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 20.x
- Lambda functions deployed via Terraform (see [`xomappetit-infrastructure`](https://github.com/Xomware/xomappetit-infrastructure) repo)

## Installing Dependencies

```bash
npm install
```

## Deploying a Single Function

Each function lives in `functions/<name>/index.js` and uses shared code from `shared/`.

To deploy a function manually:

```bash
# Create a deployment package (from repo root)
zip -r function.zip functions/<name>/index.js shared/ node_modules/ package.json

# Update the Lambda function
aws lambda update-function-code \
  --function-name meals-<name> \
  --zip-file fileb://function.zip
```

## Environment Variables

Each Lambda function needs these environment variables configured:

| Variable | Description | Example |
|----------|-------------|---------|
| `MEALS_TABLE_NAME` | DynamoDB meals table name | `xomappetit-meals` |
| `RATINGS_TABLE_NAME` | DynamoDB ratings table name | `xomappetit-meal-ratings` |
| `COMMENTS_TABLE_NAME` | DynamoDB comments table name | `xomappetit-meal-comments` |

> **Note:** Authentication is handled by the API Gateway `COGNITO_USER_POOLS` authorizer using the shared **xomware-users** pool. Lambdas read JWT claims from `event.requestContext.authorizer.claims` — no auth-related env vars required.

## Terraform Deployment

Lambda creation, API Gateway routing, DynamoDB, and IAM are managed by Terraform in the [`xomappetit-infrastructure`](https://github.com/Xomware/xomappetit-infrastructure) repo. The repo's `terraform.yml` GitHub Action runs `terraform plan` on PRs and `terraform apply` on merge to main.

After infra applies, this repo's `deploy.yml` workflow updates each Lambda's code from a zip uploaded to S3 — that runs automatically on push to `main`.
