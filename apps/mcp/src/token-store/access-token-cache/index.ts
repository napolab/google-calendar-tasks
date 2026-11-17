// When the Durable Object may hand out its cached access token. Pure: the clock is passed in.

// Refresh a little early so a token never expires between being handed out and being used.
export const EXPIRY_SKEW_MS = 60_000;

// The cached token remembers the refresh token it was minted from, so a token of an older connection is never
// handed out after a reconnect.
export type CachedAccessToken = { readonly accessToken: string; readonly expiresAt: number; readonly refreshToken: string };

export type CacheDecision = { readonly kind: 'use'; readonly accessToken: string } | { readonly kind: 'refresh' };

const isUsable = (cached: CachedAccessToken, refreshToken: string, now: number): boolean => cached.refreshToken === refreshToken && now < cached.expiresAt - EXPIRY_SKEW_MS;

export const decideAccessToken = (cached: CachedAccessToken | undefined, refreshToken: string, now: number): CacheDecision => {
  if (cached === undefined || !isUsable(cached, refreshToken, now)) return { kind: 'refresh' };
  return { kind: 'use', accessToken: cached.accessToken };
};
