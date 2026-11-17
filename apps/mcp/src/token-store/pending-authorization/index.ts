import { err, ok } from 'neverthrow';

import { OAuthStateError } from '../../errors';

import type { Result } from 'neverthrow';

// The OAuth authorization a user started on /google/connect and has not finished yet. Pure: the clock is passed in.

export const PENDING_AUTHORIZATION_TTL_MS = 10 * 60_000;

export type PendingAuthorization = { readonly state: string; readonly codeVerifier: string; readonly expiresAt: number };

export type AuthorizationStart = { readonly state: string; readonly codeVerifier: string };

export const createPendingAuthorization = (start: AuthorizationStart, now: number): PendingAuthorization => ({ ...start, expiresAt: now + PENDING_AUTHORIZATION_TTL_MS });

// The PKCE verifier of the pending authorization `state` names. The caller deletes the pending authorization
// whatever the outcome, so a state is good for one callback only.
export const checkPendingAuthorization = (pending: PendingAuthorization | undefined, state: string, now: number): Result<string, OAuthStateError> => {
  if (pending === undefined) return err(new OAuthStateError('missing'));
  if (pending.state !== state) return err(new OAuthStateError('mismatch'));
  if (now >= pending.expiresAt) return err(new OAuthStateError('expired'));
  return ok(pending.codeVerifier);
};
