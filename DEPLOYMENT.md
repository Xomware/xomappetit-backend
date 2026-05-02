# Deployment Guide

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 20.x
- Lambda functions deployed via AWS CDK (see `meals-infra` repo)

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
| `MEALS_TABLE_NAME` | DynamoDB meals table name | `meals` |
| `RATINGS_TABLE_NAME` | DynamoDB ratings table name | `meal-ratings` |
| `COMMENTS_TABLE_NAME` | DynamoDB comments table name | `meal-comments` |
| `AUTH_HASH_PARAM` | SSM parameter path for auth hash | `/meals-app/auth-hash` |

> **Note:** `AUTH_HASH_PARAM` is only needed by the authorizer function.

## CDK Deployment

The recommended deployment method is via the `meals-infra` CDK stack, which handles all Lambda creation, API Gateway routing, and environment configuration automatically.

```bash
cd ../meals-infra
npx cdk deploy
```
