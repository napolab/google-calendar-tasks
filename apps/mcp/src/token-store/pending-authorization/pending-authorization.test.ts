import { describe, expect, it } from 'vitest';

import { OAuthStateError } from '../../errors';
import { PENDING_AUTHORIZATION_TTL_MS, checkPendingAuthorization, createPendingAuthorization } from './index';

const NOW = 1_700_000_000_000;

const pending = createPendingAuthorization({ state: 'state-1', codeVerifier: 'verifier-1' }, NOW);

const problemOf = (result: ReturnType<typeof checkPendingAuthorization>) => {
  const error = result._unsafeUnwrapErr();
  expect(error).toBeInstanceOf(OAuthStateError);
  return error.problem;
};

describe('createPendingAuthorization', () => {
  it('expires after the TTL', () => {
    expect(pending).toEqual({ state: 'state-1', codeVerifier: 'verifier-1', expiresAt: NOW + PENDING_AUTHORIZATION_TTL_MS });
    expect(PENDING_AUTHORIZATION_TTL_MS).toBe(10 * 60_000);
  });
});

describe('checkPendingAuthorization', () => {
  it('returns the PKCE verifier for the matching state before it expires', () => {
    expect(checkPendingAuthorization(pending, 'state-1', NOW + PENDING_AUTHORIZATION_TTL_MS - 1)._unsafeUnwrap()).toBe('verifier-1');
  });

  it('rejects when no authorization is pending', () => {
    expect(problemOf(checkPendingAuthorization(undefined, 'state-1', NOW))).toBe('missing');
  });

  it('rejects another state', () => {
    expect(problemOf(checkPendingAuthorization(pending, 'state-2', NOW))).toBe('mismatch');
  });

  it('rejects at and after the expiry', () => {
    expect(problemOf(checkPendingAuthorization(pending, 'state-1', NOW + PENDING_AUTHORIZATION_TTL_MS))).toBe('expired');
  });
});
