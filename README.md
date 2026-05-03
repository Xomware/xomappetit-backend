# Xom Appétit — Backend API

Serverless backend for **Xom Appétit**, a meal-tracking app. Built with AWS Lambda, API Gateway, and DynamoDB.

## Architecture

- **Runtime:** Node.js 20.x (CommonJS)
- **Database:** DynamoDB (`xomappetit-meals`, `xomappetit-meal-ratings`, `xomappetit-meal-comments`)
- **Auth:** `X-Auth-Hash` header validated by Lambda authorizer against AWS SSM Parameter Store
- **API host:** `api.xomappetit.xomware.com`
- **Infrastructure:** Defined in [`xomappetit-infrastructure`](https://github.com/Xomware/xomappetit-infrastructure)

## API style

Flat verb-style routes under the `/meals` service prefix. Resource IDs travel in the **request body**, not the path. This matches the convention used by other Xomware apps (xomify, xomper, etc.) and the shared `api-gateway-service` Terraform module.

## Project Structure

```
functions/
  authorizer/index.js              # X-Auth-Hash validation against SSM
  meals-list/index.js              # GET    /meals/list
  meals-create/index.js            # POST   /meals/create
  meals-get/index.js               # POST   /meals/get          (id in body)
  meals-edit/index.js              # POST   /meals/edit         (id + fields in body)
  meals-update/index.js            # POST   /meals/update       (toggle-cooked; id in body)
  meals-delete/index.js            # POST   /meals/delete       (id in body)
  meals-rate/index.js              # POST   /meals/rate         (id + rating in body)
  meals-ratings/index.js           # POST   /meals/ratings      (id in body)
  meals-comment-add/index.js       # POST   /meals/comment-add
  meals-comments-list/index.js     # POST   /meals/comments-list
  meals-comment-delete/index.js    # POST   /meals/comment-delete
shared/
  auth.js                          # Extract userId from authorizer context
  dynamo.js                        # DynamoDB DocumentClient singleton
  ingredients.js                   # Ingredient + meal normalization helpers
  response.js                      # Standardized CORS response helpers
```

## API Reference

All endpoints require the `X-Auth-Hash` header for authentication. Bodies are JSON.

### List meals

```
GET /meals/list
```

Returns all meals for the authenticated user.

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

> Legacy meals stored `ingredients` as `List<String>`. They're auto-normalized on read into `{ name, quantity: null, unit: null }`. New writes always use the structured shape.

### Create meal

```
POST /meals/create
```

**Body:**
```json
{
  "name": "Chicken Stir Fry",
  "timeMinutes": 25,
  "difficulty": "Easy",
  "proteinSource": "Chicken",
  "ingredients": [
    { "name": "chicken breast", "quantity": 1, "unit": "lb" }
  ],
  "instructions": ["Heat oil in a wok", "Add chicken"],
  "macros": { "calories": 450, "protein": 40, "carbs": 20, "fat": 15 }
}
```

**Response:** `201 Created` — returns the created meal object.

### Get meal

```
POST /meals/get
```

**Body:** `{ "id": "<mealId>" }`

**Response:** `200 OK` — returns the meal object.

### Edit meal

```
POST /meals/edit
```

General field update for an existing meal. Editable fields: `name`, `timeMinutes`, `difficulty`, `proteinSource`, `ingredients`, `instructions`, `macros`. Other fields are ignored.

**Body:** `{ "id": "<mealId>", ...editable fields }`

**Response:** `200 OK` — returns the updated meal object.

### Toggle cooked

```
POST /meals/update
```

Toggles the `cooked` boolean.

**Body:** `{ "id": "<mealId>" }`

**Response:** `200 OK` — returns the updated meal object.

### Rate meal

```
POST /meals/rate
```

**Body:**
```json
{
  "id": "<mealId>",
  "taste": 4,
  "ease": 5,
  "speed": 3,
  "healthiness": 4,
  "notes": "Great weeknight meal"
}
```

Rating values are 1-5. Saves to both the meal record (embedded) and the ratings table.

**Response:** `200 OK` — returns the updated meal object.

### Delete meal

```
POST /meals/delete
```

**Body:** `{ "id": "<mealId>" }`

**Response:** `204 No Content`

### Get ratings

```
POST /meals/ratings
```

**Body:** `{ "id": "<mealId>" }`

**Response:** `200 OK` — array of rating records for the meal.

### List comments

```
POST /meals/comments-list
```

**Body:** `{ "mealId": "<mealId>" }`

**Response:** `200 OK` — array of comments sorted oldest → newest.

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

### Add comment

```
POST /meals/comment-add
```

**Body:** `{ "mealId": "<mealId>", "body": "<text>" }`

`body` is required, max 2000 chars.

**Response:** `201 Created` — returns the created comment.

### Delete comment

```
POST /meals/comment-delete
```

**Body:** `{ "mealId": "<mealId>", "commentId": "<commentId>" }`

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
