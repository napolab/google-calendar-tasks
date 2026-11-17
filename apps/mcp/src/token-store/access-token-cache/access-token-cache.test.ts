import { describe, expect, it } from 'vitest';

import { EXPIRY_SKEW_MS, decideAccessToken } from './index';

const NOW = 1_700_000_000_000;

const cached = (expiresAt: number, refreshToken = 'refresh-1') => ({ accessToken: 'access-1', expiresAt, refreshToken });

describe('decideAccessToken', () => {
  it('refreshes when nothing is cached', () => {
    expect(decideAccessToken(undefined, 'refresh-1', NOW)).toEqual({ kind: 'refresh' });
  });

  it('uses a cached token that is valid for more than the skew', () => {
    expect(decideAccessToken(cached(NOW + EXPIRY_SKEW_MS + 1), 'refresh-1', NOW)).toEqual({ kind: 'use', accessToken: 'access-1' });
  });

  it('refreshes a token within the skew of its expiry', () => {
    expect(decideAccessToken(cached(NOW + EXPIRY_SKEW_MS), 'refresh-1', NOW)).toEqual({ kind: 'refresh' });
  });

  it('refreshes an expired token', () => {
    expect(decideAccessToken(cached(NOW - 1), 'refresh-1', NOW)).toEqual({ kind: 'refresh' });
  });

  it('never uses a token minted for another refresh token (an older connection)', () => {
    expect(decideAccessToken(cached(NOW + 3_600_000, 'refresh-old'), 'refresh-1', NOW)).toEqual({ kind: 'refresh' });
  });
});
