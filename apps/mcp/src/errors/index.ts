import { GoogleAuthError } from '@napolab/gct-core/errors';

// Error channel of apps/mcp (.claude/skills/modeling-errors-as-classes). Discriminate with instanceof at the
// edge (Hono handler / MCP tool result); `name` is the stable id for logs.

// ---- Cloudflare Access (src/access-auth) ----

// CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD is empty: every request fails closed with 500.
export class AccessNotConfiguredError extends Error {
  override name = 'AccessNotConfiguredError' as const;
}

// The request carries no Cf-Access-Jwt-Assertion header (it did not come through Access).
export class MissingAccessAssertion extends Error {
  override name = 'MissingAccessAssertion' as const;
}

// The assertion failed verification (signature, issuer, audience, expiry) or carries no email.
// The jose error, if any, rides on `cause`; it never reaches a response body.
export class InvalidAccessAssertion extends Error {
  override name = 'InvalidAccessAssertion' as const;
}

export type AccessAuthError = MissingAccessAssertion | InvalidAccessAssertion;

// ---- Google connection (src/token-store) ----
// Both are GoogleAuthError subclasses so they fit core's GetAccessToken channel; `name` stays the inherited
// 'GoogleAuthError' (core declares it as a literal), so tell them apart with instanceof.

// This Access user has never connected Google, or disconnected it.
export class GoogleNotConnectedError extends GoogleAuthError {}

// Google answered invalid_grant for the stored refresh token (expired, revoked, or the consent screen is in
// Testing and the 7-day limit passed). The connection was dropped; the user has to connect again.
export class GoogleReconnectRequiredError extends GoogleAuthError {}

// The Durable Object call itself failed (network / runtime error between the Worker and the DO).
export class TokenStoreUnavailableError extends Error {
  override name = 'TokenStoreUnavailableError' as const;
}

// ---- MCP task tools ----

const describeAvailableLists = (titles: readonly string[]): string =>
  titles.length === 0 ? 'There are no task lists in this account.' : `Available task lists: ${titles.map((title) => `"${title}"`).join(', ')}.`;

// `list` was omitted, so the configured default task list (DEFAULT_TASK_LIST) was used, but no list in the user's
// account has that id or title. Built from core's TaskListNotFoundError, whose titles it repeats.
export class DefaultTaskListNotFoundError extends Error {
  override name = 'DefaultTaskListNotFoundError' as const;
  readonly query: string;
  readonly titles: readonly string[];

  constructor(query: string, titles: readonly string[]) {
    super(
      `list was omitted, so this server's default task list "${query}" (DEFAULT_TASK_LIST) was used, but no task list has that id or title. ${describeAvailableLists(titles)} Pass list explicitly: one of these titles, an id from list_task_lists, or '@default' for Google's own default list. Only if the user asks for it, create "${query}" with create_task_list.`,
    );
    this.query = query;
    this.titles = titles;
  }
}

// ---- OAuth callback ----

export type OAuthStateProblem = 'missing' | 'mismatch' | 'expired';

// The `state` of a callback does not match a pending authorization of this user (unknown, forged, already used
// or older than its TTL).
export class OAuthStateError extends Error {
  override name = 'OAuthStateError' as const;
  readonly problem: OAuthStateProblem;

  constructor(problem: OAuthStateProblem) {
    super(`OAuth state rejected: ${problem}`);
    this.problem = problem;
  }
}

// Google granted fewer scopes than the server needs (the user unticked a checkbox on the consent screen).
export class MissingScopesError extends Error {
  override name = 'MissingScopesError' as const;
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`Google did not grant: ${missing.join(', ')}`);
    this.missing = missing;
  }
}
