'use strict';

/**
 * Extract userId (Cognito `sub`) from the API Gateway COGNITO_USER_POOLS
 * authorizer context.
 *
 * REST API + COGNITO_USER_POOLS authorizer puts validated JWT claims at
 * `event.requestContext.authorizer.claims`. The `sub` claim (UUID v4) is
 * the canonical user identity across Xomware apps and matches the
 * `userId` partition key on every DynamoDB table in this service.
 *
 * Note: the HTTP API JWT authorizer uses a different shape
 * (`authorizer.jwt.claims`); this service uses REST API, so we read
 * `authorizer.claims` directly.
 */
const getUserId = (event) => {
  const sub = event.requestContext?.authorizer?.claims?.sub;
  if (!sub) throw new Error('Missing sub claim in authorizer context');
  return sub;
};

/**
 * Extract Cognito groups from the authorizer claims.
 *
 * The REST API COGNITO_USER_POOLS authorizer serializes `cognito:groups`
 * as a string (often bracket-wrapped, comma-separated, e.g. `[admin, beta]`).
 * Some configurations pass it through as an array — handle both shapes
 * defensively. Returns `[]` when no groups are present.
 */
const getGroups = (event) => {
  const groupsClaim = event.requestContext?.authorizer?.claims?.['cognito:groups'];
  if (!groupsClaim) return [];
  if (typeof groupsClaim === 'string') {
    return groupsClaim
      .replace(/^\[|\]$/g, '')
      .split(/,\s*/)
      .filter(Boolean);
  }
  return Array.isArray(groupsClaim) ? groupsClaim : [];
};

/**
 * True when the caller is in the shared `admin` Cognito group.
 * Used by Phase 5 admin endpoints; ships now to keep `shared/auth.js`
 * stable across the cutover.
 */
const isAdmin = (event) => getGroups(event).includes('admin');

module.exports = { getUserId, getGroups, isAdmin };
