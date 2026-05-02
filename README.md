# Meals Backend API

Serverless backend for the Meals tracking application. Built with AWS Lambda, API Gateway, and DynamoDB.

## Architecture

- **Runtime:** Node.js 20.x (CommonJS)
- **Database:** DynamoDB (meals + meal-ratings tables)
- **Auth:** `X-Auth-Hash` header validated by Lambda authorizer against AWS SSM Parameter Store
- **Infrastructure:** Defined in [`meals-infra`](https://github.com/Xomware/meals-infra)

## Project Structure

```
functions/
  authorizer/index.js              # X-Auth-Hash validation against SSM
  meals-list/index.js              # GET /meals
  meals-create/index.js            # POST /meals
  meals-get/index.js               # GET /meals/{id}
  meals-edit/index.js              # PATCH /meals/{id}
  meals-update/index.js            # PATCH /meals/{id}/toggle-cooked
  meals-delete/index.js            # DELETE /meals/{id}
  meals-rate/index.js              # PATCH /meals/{id}/rate
  meals-ratings/index.js           # GET /meals/{id}/ratings
  meals-comment-add/index.js       # POST /meals/{id}/comments
  meals-comments-list/index.js     # GET /meals/{id}/comments
  meals-comment-delete/index.js    # DELETE /meals/{id}/comments/{commentId}
shared/
  auth.js                          # Extract userId from authorizer context
  dynamo.js                        # DynamoDB DocumentClient singleton
  ingredients.js                   # Ingredient + meal normalization helpers
  response.js                      # Standardized CORS response helpers
```

## API Reference

All endpoints require the `X-Auth-Hash` header for authentication.

### List Meals

```
GET /meals
```

Returns an array of all meals for the authenticated user.

**Response:** `200 OK`
```json
[
  {
    "userId": "abc123",
    "mealId": "uuid",
    "id": "uuid",
    "name": "Chicken Stir Fry",
    "timeMinutes": 25,
    "difficulty": "Easy",
    "proteinSource": "Chicken",
    "ingredients": [
      { "name": "chicken breast", "quantity": 1, "unit": "lb" },
      { "name": "broccoli", "quantity": 2, "unit": "cups" },
      { "name": "soy sauce", "quantity": 3, "unit": "tbsp" }
    ],
    "instructions": [
      "Heat oil in a wok over high heat",
      "Add chicken, stir-fry until cooked through",
      "Add broccoli and soy sauce, toss to combine"
    ],
    "macros": { "calories": 450, "protein": 40, "carbs": 20, "fat": 15 },
    "cooked": false,
    "createdAt": "2026-03-01T12:00:00.000Z"
  }
]
```

> **Note:** Legacy meals with `ingredients` as `List<String>` are auto-normalized on read into `{ name, quantity: null, unit: null }`. New writes always use the structured shape.

### Create Meal

```
POST /meals
```

**Body:**
```json
{
  "name": "Chicken Stir Fry",
  "timeMinutes": 25,
  "difficulty": "Easy",
  "proteinSource": "Chicken",
  "ingredients": [
    { "name": "chicken breast", "quantity": 1, "unit": "lb" },
    { "name": "broccoli", "quantity": 2, "unit": "cups" }
  ],
  "instructions": [
    "Heat oil in a wok",
    "Add chicken, then broccoli"
  ],
  "macros": { "calories": 450, "protein": 40, "carbs": 20, "fat": 15 }
}
```

**Response:** `201 Created` — returns the created meal object.

### Edit Meal

```
PATCH /meals/{id}
```

General field update for an existing meal. Editable fields: `name`, `timeMinutes`, `difficulty`, `proteinSource`, `ingredients`, `instructions`, `macros`. Other fields (e.g. `userId`, `mealId`, `createdAt`, `cooked`) are ignored.

**Body:** any subset of editable fields.

**Response:** `200 OK` — returns the updated meal object.

### Get Meal

```
GET /meals/{id}
```

**Response:** `200 OK` — returns a single meal object.

### Toggle Cooked

```
PATCH /meals/{id}/toggle-cooked
```

Toggles the `cooked` boolean on the meal.

**Response:** `200 OK` — returns the updated meal object.

### Rate Meal

```
PATCH /meals/{id}/rate
```

**Body:**
```json
{
  "taste": 4,
  "ease": 5,
  "speed": 3,
  "healthiness": 4,
  "notes": "Great weeknight meal"
}
```

Rating values are 1-5. Saves to both the meal record (embedded) and the ratings table.

**Response:** `200 OK` — returns the updated meal object with rating.

### Delete Meal

```
DELETE /meals/{id}
```

**Response:** `204 No Content`

### Get Ratings

```
GET /meals/{id}/ratings
```

**Response:** `200 OK` — returns an array of rating records for the meal.

### List Comments

```
GET /meals/{id}/comments
```

**Response:** `200 OK` — returns an array of comments sorted oldest → newest.

```json
[
  {
    "mealId": "uuid",
    "commentId": "uuid",
    "userId": "abc123",
    "body": "Tried this with extra garlic, way better.",
    "createdAt": "2026-04-15T18:32:00.000Z"
  }
]
```

### Add Comment

```
POST /meals/{id}/comments
```

**Body:**
```json
{ "body": "Tried this with extra garlic, way better." }
```

`body` is required, max 2000 chars.

**Response:** `201 Created` — returns the created comment.

### Delete Comment

```
DELETE /meals/{id}/comments/{commentId}
```

Only the original author can delete their comment.

**Response:** `204 No Content`

## Authentication

All requests must include the `X-Auth-Hash` header. The Lambda authorizer validates this hash against an SSM parameter (`AUTH_HASH_PARAM`). A consistent `userId` is derived from the hash for data partitioning.

## Setup

```bash
npm install
cp .env.example .env  # Edit with your values
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment instructions and [SCHEMA.md](./SCHEMA.md) for DynamoDB schema details.
