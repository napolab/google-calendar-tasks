import { describe, expect, it } from 'vitest';

import { GoogleAuthError, GoogleNetworkError, GoogleResponseParseError } from '../errors';

import { buildAuthorizationURL, createPKCE, createRefreshTokenProvider, exchangeAuthorizationCode, refreshAccessToken, revokeToken, toCodeChallenge } from './index';

import type { AuthorizationURLParams } from './index';

type Captured = { url: string; init: RequestInit | undefined };

const fakeFetch = (respond: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) => {
  const calls: Captured[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : `${input}`;
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fetch, calls };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const formOf = (init: RequestInit | undefined) => Object.fromEntries(new URLSearchParams(`${init?.body ?? ''}`));

const NOW = 1_700_000_000_000;

describe('toCodeChallenge', () => {
  it('derives the S256 challenge from the RFC 7636 Appendix B verifier', async () => {
    const challenge = await toCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');

    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('createPKCE', () => {
  it('creates a 43-char base64url verifier (32 random bytes)', async () => {
    const { verifier } = await createPKCE();

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('pairs the verifier with its S256 challenge', async () => {
    const { verifier, challenge } = await createPKCE();

    expect(challenge).toBe(await toCodeChallenge(verifier));
  });

  it('creates a different verifier each time', async () => {
    const [a, b] = await Promise.all([createPKCE(), createPKCE()]);

    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('buildAuthorizationURL', () => {
  const base = {
    clientId: 'client-1.apps.googleusercontent.com',
    redirectURI: 'http://127.0.0.1:53682',
    scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks'],
    state: 'state-xyz',
    codeChallenge: 'challenge-abc',
    account: { kind: 'any' },
  } satisfies AuthorizationURLParams;

  it('targets the Google authorization endpoint', () => {
    const url = new URL(buildAuthorizationURL(base));

    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('sets the code flow, PKCE, offline access and consent parameters', () => {
    const params = new URL(buildAuthorizationURL(base)).searchParams;

    expect(Object.fromEntries(params)).toEqual({
      client_id: 'client-1.apps.googleusercontent.com',
      redirect_uri: 'http://127.0.0.1:53682',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks',
      state: 'state-xyz',
      code_challenge: 'challenge-abc',
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
  });

  it('adds login_hint only for a hinted account', () => {
    const without = new URL(buildAuthorizationURL(base)).searchParams;
    const withHint = new URL(buildAuthorizationURL({ ...base, account: { kind: 'hint', loginHint: 'me@example.com' } })).searchParams;

    expect(without.has('login_hint')).toBe(false);
    expect(withHint.get('login_hint')).toBe('me@example.com');
  });
});

describe('exchangeAuthorizationCode', () => {
  const tokenBody = {
    access_token: 'access-1',
    expires_in: 3599,
    refresh_token: 'refresh-1',
    scope: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar',
    token_type: 'Bearer',
  };

  const exchangeWith = (respond: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) => {
    const fake = fakeFetch(respond);
    const result = exchangeAuthorizationCode({
      fetch: fake.fetch,
      clientId: 'client-1',
      clientSecret: 'secret-1',
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectURI: 'http://127.0.0.1:53682',
      now: () => NOW,
    });
    return { result, calls: fake.calls };
  };

  it('POSTs a form-encoded authorization_code grant to the token endpoint', async () => {
    const { result, calls } = exchangeWith(() => json(tokenBody));
    await result;

    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(formOf(calls[0]?.init)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      client_secret: 'secret-1',
      code: 'code-1',
      code_verifier: 'verifier-1',
      redirect_uri: 'http://127.0.0.1:53682',
    });
  });

  it('returns the token set with an absolute expiry and split scopes', async () => {
    const { result } = exchangeWith(() => json(tokenBody));

    expect((await result)._unsafeUnwrap()).toEqual({
      accessToken: 'access-1',
      expiresAt: NOW + 3599 * 1000,
      refreshToken: 'refresh-1',
      scope: ['https://www.googleapis.com/auth/tasks', 'https://www.googleapis.com/auth/calendar'],
    });
  });

  it('fails with GoogleAuthError mentioning prompt=consent when no refresh token is returned', async () => {
    const { refresh_token: _omitted, ...withoutRefresh } = tokenBody;
    const { result } = exchangeWith(() => json(withoutRefresh));

    const error = (await result)._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error.message).toContain('prompt=consent');
  });

  it('maps an OAuth error body to GoogleAuthError carrying the error code', async () => {
    const { result } = exchangeWith(() => json({ error: 'invalid_grant', error_description: 'Bad Request' }, 400));

    const error = (await result)._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error.message).toContain('invalid_grant');
  });

  it('maps a non-JSON error response to GoogleAuthError with the status', async () => {
    const { result } = exchangeWith(() => new Response('<html>oops</html>', { status: 503 }));

    const error = (await result)._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error.message).toContain('503');
    expect(error.message).not.toContain('oops');
  });

  it('maps a rejected fetch to GoogleNetworkError', async () => {
    const { result } = exchangeWith(() => Promise.reject(new TypeError('fetch failed')));

    expect((await result)._unsafeUnwrapErr()).toBeInstanceOf(GoogleNetworkError);
  });

  it('maps an unexpected 2xx body to GoogleResponseParseError', async () => {
    const { result } = exchangeWith(() => json({ nope: true }));

    expect((await result)._unsafeUnwrapErr()).toBeInstanceOf(GoogleResponseParseError);
  });

  it('never echoes the client secret in error messages', async () => {
    const { result } = exchangeWith(() => json({ error: 'invalid_client', error_description: 'Unauthorized' }, 401));

    expect((await result)._unsafeUnwrapErr().message).not.toContain('secret-1');
  });
});

const refreshBody = (accessToken: string, expiresIn = 3599) => ({
  access_token: accessToken,
  expires_in: expiresIn,
  scope: 'https://www.googleapis.com/auth/calendar',
  token_type: 'Bearer',
});

describe('refreshAccessToken', () => {
  const refreshWith = (respond: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) => {
    const fake = fakeFetch(respond);
    const result = refreshAccessToken({ fetch: fake.fetch, clientId: 'client-1', clientSecret: 'secret-1', refreshToken: 'refresh-1', now: () => NOW });
    return { result, calls: fake.calls };
  };

  it('POSTs a form-encoded refresh_token grant to the token endpoint', async () => {
    const { result, calls } = refreshWith(() => json(refreshBody('access-2')));
    await result;

    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(formOf(calls[0]?.init)).toEqual({ grant_type: 'refresh_token', client_id: 'client-1', client_secret: 'secret-1', refresh_token: 'refresh-1' });
  });

  it('returns the new access token with an absolute expiry', async () => {
    const { result } = refreshWith(() => json(refreshBody('access-2', 100)));

    expect((await result)._unsafeUnwrap()).toEqual({ accessToken: 'access-2', expiresAt: NOW + 100_000, scope: ['https://www.googleapis.com/auth/calendar'] });
  });

  it('maps invalid_grant to GoogleAuthError telling the user to log in again', async () => {
    const { result } = refreshWith(() => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400));

    const error = (await result)._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error.message).toMatch(/log in again/);
    expect(error.message).not.toContain('refresh-1');
  });

  it('maps a rejected fetch to GoogleNetworkError', async () => {
    const { result } = refreshWith(() => Promise.reject(new TypeError('fetch failed')));

    expect((await result)._unsafeUnwrapErr()).toBeInstanceOf(GoogleNetworkError);
  });
});

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('createRefreshTokenProvider', () => {
  const providerWith = (respond: (url: string, init: RequestInit | undefined) => Response | Promise<Response>, now: () => number) => {
    const fake = fakeFetch(respond);
    const getAccessToken = createRefreshTokenProvider({ fetch: fake.fetch, clientId: 'client-1', clientSecret: 'secret-1', refreshToken: 'refresh-1', now });
    return { getAccessToken, calls: fake.calls };
  };

  it('refreshes on first use and returns the access token', async () => {
    const { getAccessToken } = providerWith(
      () => json(refreshBody('access-1')),
      () => NOW,
    );

    expect((await getAccessToken())._unsafeUnwrap()).toBe('access-1');
  });

  it('reuses the cached token while it is more than 60s from expiry', async () => {
    let clock = NOW;
    let issued = 0;
    const { getAccessToken, calls } = providerWith(
      () => json(refreshBody(`access-${++issued}`, 3600)),
      () => clock,
    );

    await getAccessToken();
    clock = NOW + 3600_000 - 60_001;
    const second = await getAccessToken();

    expect(second._unsafeUnwrap()).toBe('access-1');
    expect(calls).toHaveLength(1);
  });

  it('refreshes again once the token is within 60s of expiry', async () => {
    let clock = NOW;
    let issued = 0;
    const { getAccessToken, calls } = providerWith(
      () => json(refreshBody(`access-${++issued}`, 3600)),
      () => clock,
    );

    await getAccessToken();
    clock = NOW + 3600_000 - 60_000;
    const second = await getAccessToken();

    expect(second._unsafeUnwrap()).toBe('access-2');
    expect(calls).toHaveLength(2);
  });

  it('coalesces concurrent refreshes into one request', async () => {
    const pending = deferred<Response>();
    const { getAccessToken, calls } = providerWith(
      () => pending.promise,
      () => NOW,
    );

    const first = getAccessToken();
    const second = getAccessToken();
    pending.resolve(json(refreshBody('access-1')));
    const results = await Promise.all([first, second]);

    expect(results.map((r) => r._unsafeUnwrap())).toEqual(['access-1', 'access-1']);
    expect(calls).toHaveLength(1);
  });

  it('does not cache a failure: the next call retries', async () => {
    let attempt = 0;
    const { getAccessToken, calls } = providerWith(
      () => {
        attempt += 1;
        return attempt === 1 ? new Response('', { status: 503 }) : json(refreshBody('access-1'));
      },
      () => NOW,
    );

    const first = await getAccessToken();
    const second = await getAccessToken();

    expect(first._unsafeUnwrapErr()).toBeInstanceOf(GoogleAuthError);
    expect(second._unsafeUnwrap()).toBe('access-1');
    expect(calls).toHaveLength(2);
  });

  it('reports network and parse failures as GoogleAuthError keeping the cause', async () => {
    const network = providerWith(
      () => Promise.reject(new TypeError('fetch failed')),
      () => NOW,
    );
    const parse = providerWith(
      () => json({ nope: true }),
      () => NOW,
    );

    const networkError = (await network.getAccessToken())._unsafeUnwrapErr();
    const parseError = (await parse.getAccessToken())._unsafeUnwrapErr();

    expect(networkError).toBeInstanceOf(GoogleAuthError);
    expect(networkError.cause).toBeInstanceOf(GoogleNetworkError);
    expect(parseError).toBeInstanceOf(GoogleAuthError);
    expect(parseError.cause).toBeInstanceOf(GoogleResponseParseError);
  });
});

describe('revokeToken', () => {
  it('POSTs the token form-encoded to the revoke endpoint', async () => {
    const fake = fakeFetch(() => new Response('', { status: 200 }));

    const result = await revokeToken({ fetch: fake.fetch, token: 'refresh-1' });

    expect(result.isOk()).toBe(true);
    expect(fake.calls[0]?.url).toBe('https://oauth2.googleapis.com/revoke');
    expect(fake.calls[0]?.init?.method).toBe('POST');
    expect(new Headers(fake.calls[0]?.init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(formOf(fake.calls[0]?.init)).toEqual({ token: 'refresh-1' });
  });

  it('maps a non-2xx answer to GoogleAuthError without echoing the token', async () => {
    const fake = fakeFetch(() => json({ error: 'invalid_token' }, 400));

    const error = (await revokeToken({ fetch: fake.fetch, token: 'refresh-1' }))._unsafeUnwrapErr();

    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error.message).toContain('invalid_token');
    expect(error.message).not.toContain('refresh-1');
  });

  it('maps a rejected fetch to GoogleNetworkError', async () => {
    const fake = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));

    expect((await revokeToken({ fetch: fake.fetch, token: 'refresh-1' }))._unsafeUnwrapErr()).toBeInstanceOf(GoogleNetworkError);
  });
});
