# DynamoDB Schema

## `meals` Table

| Attribute | Type | Key |
|-----------|------|-----|
| userId | String | Partition Key (PK) |
| mealId | String | Sort Key (SK) |
| id | String | Same as mealId (frontend compat) |
| name | String | |
| timeMinutes | Number | |
| difficulty | String | `Easy` / `Medium` / `Hard` |
| proteinSource | String | |
| ingredients | List\<Map\> | `[{ name, quantity, unit }]` — `quantity` and `unit` may be `null` |
| instructions | List\<String\> | Ordered cooking steps |
| macros | Map | `{ calories, protein, carbs, fat }` |
| cooked | Boolean | |
| rating | Map | Optional `{ taste, ease, speed, healthiness, notes }` |
| createdAt | String | ISO 8601 timestamp |

### Backward compatibility

Legacy meals stored `ingredients` as `List<String>`. Lambdas normalize on read: any string item is coerced to `{ name: <string>, quantity: null, unit: null }`. New writes always use the structured shape.

## `meal-ratings` Table

| Attribute | Type | Key |
|-----------|------|-----|
| userId | String | Partition Key (PK) |
| mealId | String | Sort Key (SK) |
| taste | Number | 1-5 |
| ease | Number | 1-5 |
| speed | Number | 1-5 |
| healthiness | Number | 1-5 |
| notes | String | |
| ratedAt | String | ISO 8601 timestamp |

### GSI: `mealId-userId-index`

| Attribute | Key |
|-----------|-----|
| mealId | Partition Key |
| userId | Sort Key |

Allows querying all ratings for a given meal across users.

## `meal-comments` Table

| Attribute | Type | Key |
|-----------|------|-----|
| mealId | String | Partition Key (PK) |
| commentId | String (uuid) | Sort Key (SK) |
| userId | String | (used for delete authz) |
| body | String | Comment text, max 2000 chars |
| createdAt | String | ISO 8601 timestamp |

Per-meal global thread. No GSI in v1 — always queried by `mealId`.
