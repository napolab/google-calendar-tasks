import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GoogleAuthError } from '@napolab/gct-core/errors';
import { err, errAsync, ok, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCredentialStore } from '../credential-store';

import { AuthorizationDeniedError, ConfigError, InvalidCallbackError, LoginTimeoutError, NotLoggedInError } from '../../context/errors';
import { createAuthService, createGetAccessToken, login, logout } from './index';
import { startLoopbackServer } from './loopback-server';
import { BrowserOpenError } from './open-browser';
import { OpenCommandError } from './open-browser/run-command';

import type { LoginCallback } from './callback-app';
import type { AuthServiceDeps, LoginDeps } from './index';
import type { LoopbackServer, LoopbackServerOptions, OwnedLoopbackServer } from './loopback-server';
import type { CredentialStore } from '../credential-store';
import type { ResultAsync } from 'neverthrow';

type Captured = { url: string; body: URLSearchParams };

const NOW = Date.UTC(2026, 10, 17, 4, 0, 0);
const CONFIG = { clientId: 'client-1', clientSecret: 'secret-1' };
const SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks'];
const REDIRECT_URI = 'http://127.0.0.1:5555/callback';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeGoogle = (respond: (url: string, body: URLSearchParams) => Response) => {
  const calls: Captured[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : `${input}`;
    const body = new URLSearchParams(`${init?.body ?? ''}`);
    calls.push({ url, body });
    return respond(url, body);
  };
  return { fetch, calls };
};

const tokenEndpoint = () =>
  fakeGoogle((url, body) => {
    if (url === 'https://oauth2.googleapis.com/revoke') return new Response('', { status: 200 });
    if (body.get('grant_type') === 'authorization_code') return json({ access_token: 'access-1', expires_in: 3599, refresh_token: 'refresh-1', scope: SCOPES.join(' '), token_type: 'Bearer' });
    return json({ access_token: 'access-2', expires_in: 3599, scope: SCOPES.join(' '), token_type: 'Bearer' });
  });

// A LoopbackServer double whose callback is a canned outcome.
const fakeLoopback = (callback: ResultAsync<LoginCallback, LoginTimeoutError>): LoopbackServer => ({ redirectURI: REDIRECT_URI, callback });

const PKCE_PAIR = { verifier: 'v'.repeat(43), challenge: 'challenge-1' };

const noBrowser = () => okAsync({ opener: 'test-browser' });

describe('auth', () => {
  let base = '';
  let store: CredentialStore;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'gct-auth-'));
    store = createCredentialStore({ dir: join(base, 'gct') });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const loginDeps = (overrides: Partial<LoginDeps>): LoginDeps => ({
    loopback: fakeLoopback(okAsync({ kind: 'code', code: 'code-1' })),
    state: 'state-1',
    pkce: PKCE_PAIR,
    config: CONFIG,
    fetch: tokenEndpoint().fetch,
    store,
    now: () => NOW,
    scopes: SCOPES,
    openBrowser: noBrowser,
    print: () => undefined,
    ...overrides,
  });

  describe('login', () => {
    it('opens the consent URL with PKCE, the state and the loopback redirect URI', async () => {
      const opened: string[] = [];

      await login(loginDeps({ openBrowser: (url) => (opened.push(url), noBrowser()) }));

      const params = new URL(opened[0] ?? '').searchParams;
      expect(params.get('client_id')).toBe('client-1');
      expect(params.get('state')).toBe('state-1');
      expect(params.get('code_challenge')).toBe('challenge-1');
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('scope')).toBe(SCOPES.join(' '));
      expect(params.get('redirect_uri')).toBe(REDIRECT_URI);
    });

    it('keeps waiting and tells the user to open the URL manually when no browser opens', async () => {
      const lines: string[] = [];
      const failing = () => errAsync(new BrowserOpenError([new OpenCommandError('xdg-open', { kind: 'exited', code: 1 })]));

      const result = await login(loginDeps({ openBrowser: failing, print: (line) => lines.push(line) }));
      await new Promise((resolve) => setImmediate(resolve));

      expect(result.isOk()).toBe(true);
      expect(lines.join('\n')).toContain('open the URL above manually');
    });

    it('prints the consent URL so the user can open it manually', async () => {
      const lines: string[] = [];

      await login(loginDeps({ print: (line) => lines.push(line) }));

      expect(lines.join('\n')).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
    });

    it('exchanges the code with the same redirect URI and the PKCE verifier', async () => {
      const google = tokenEndpoint();

      await login(loginDeps({ fetch: google.fetch }));

      const exchange = google.calls[0]?.body;
      expect(exchange?.get('code')).toBe('code-1');
      expect(exchange?.get('redirect_uri')).toBe(REDIRECT_URI);
      expect(exchange?.get('code_verifier')).toBe(PKCE_PAIR.verifier);
    });

    it('saves the refresh token, granted scopes and creation time', async () => {
      const result = await login(loginDeps({}));

      const expected = { refreshToken: 'refresh-1', scope: SCOPES, createdAt: '2026-11-17T04:00:00.000Z' };
      expect(result._unsafeUnwrap()).toEqual(expected);
      expect((await store.read())._unsafeUnwrap()).toEqual({ kind: 'present', credentials: expected });
    });

    it('fails with InvalidCallbackError and saves nothing on a state mismatch', async () => {
      const google = tokenEndpoint();

      const result = await login(loginDeps({ fetch: google.fetch, loopback: fakeLoopback(okAsync({ kind: 'invalid', reason: 'state-mismatch' })) }));

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(InvalidCallbackError);
      expect(google.calls).toEqual([]);
      expect((await store.read())._unsafeUnwrap()).toEqual({ kind: 'missing' });
    });

    it('fails with AuthorizationDeniedError when the user declines', async () => {
      const result = await login(loginDeps({ loopback: fakeLoopback(okAsync({ kind: 'error', error: 'access_denied' })) }));

      const error = result._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(AuthorizationDeniedError);
      expect(error.message).toContain('access_denied');
    });

    it('passes a LoginTimeoutError from the loopback through', async () => {
      const result = await login(loginDeps({ loopback: fakeLoopback(errAsync(new LoginTimeoutError('late'))) }));

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(LoginTimeoutError);
    });

    it('works end to end with the real loopback server and leaves it open for its owner', async () => {
      await using loopback = (await startLoopbackServer({ expectedState: 'state-1', signal: AbortSignal.timeout(5_000) }))._unsafeUnwrap();
      const pages: Promise<Response>[] = [];
      // Plays the browser: after "consent", Google redirects to the loopback with the code and the state.
      const browser = (url: string) => {
        const params = new URL(url).searchParams;
        pages.push(fetch(`${params.get('redirect_uri') ?? ''}?state=${params.get('state') ?? ''}&code=code-1`));
        return noBrowser();
      };

      const result = await login(loginDeps({ loopback, openBrowser: browser }));
      const page = await pages[0];

      expect(result._unsafeUnwrap().refreshToken).toBe('refresh-1');
      expect(page?.status).toBe(200);
      expect(await page?.text()).toContain('close this tab');
      expect((await fetch(new URL('/favicon.ico', loopback.redirectURI))).status).toBe(404);
    });
  });

  describe('logout', () => {
    it('revokes the stored refresh token and deletes the credentials', async () => {
      const google = tokenEndpoint();
      await store.write({ refreshToken: 'refresh-1', scope: SCOPES, createdAt: '2026-11-17T04:00:00.000Z' });

      const result = await logout({ fetch: google.fetch, store });

      expect(result._unsafeUnwrap()).toEqual({ kind: 'logged-out', revocation: { kind: 'revoked' } });
      expect(google.calls[0]?.url).toBe('https://oauth2.googleapis.com/revoke');
      expect(google.calls[0]?.body.get('token')).toBe('refresh-1');
      expect((await store.read())._unsafeUnwrap()).toEqual({ kind: 'missing' });
    });

    it('still deletes the credentials when revocation fails', async () => {
      const google = fakeGoogle(() => json({ error: 'invalid_token' }, 400));
      await store.write({ refreshToken: 'refresh-1', scope: SCOPES, createdAt: '2026-11-17T04:00:00.000Z' });

      const outcome = (await logout({ fetch: google.fetch, store }))._unsafeUnwrap();

      expect(outcome).toMatchObject({ kind: 'logged-out', revocation: { kind: 'revoke-failed' } });
      expect((await store.read())._unsafeUnwrap()).toEqual({ kind: 'missing' });
    });

    it('reports not-logged-in without calling Google when nothing is stored', async () => {
      const google = tokenEndpoint();

      const result = await logout({ fetch: google.fetch, store });

      expect(result._unsafeUnwrap()).toEqual({ kind: 'not-logged-in' });
      expect(google.calls).toEqual([]);
    });
  });

  describe('createGetAccessToken', () => {
    it('returns a provider that refreshes with the stored refresh token', async () => {
      const google = tokenEndpoint();
      await store.write({ refreshToken: 'refresh-1', scope: SCOPES, createdAt: '2026-11-17T04:00:00.000Z' });

      const getAccessToken = (await createGetAccessToken({ config: CONFIG, store, fetch: google.fetch, now: () => NOW }))._unsafeUnwrap();
      const token = await getAccessToken();

      expect(token._unsafeUnwrap()).toBe('access-2');
      expect(google.calls[0]?.body.get('grant_type')).toBe('refresh_token');
      expect(google.calls[0]?.body.get('refresh_token')).toBe('refresh-1');
      expect(google.calls[0]?.body.get('client_id')).toBe('client-1');
    });

    it('fails with NotLoggedInError when no credentials are stored', async () => {
      const result = await createGetAccessToken({ config: CONFIG, store, fetch: tokenEndpoint().fetch, now: () => NOW });

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotLoggedInError);
    });

    it('surfaces a revoked refresh token as GoogleAuthError from the provider', async () => {
      const google = fakeGoogle(() => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400));
      await store.write({ refreshToken: 'refresh-1', scope: SCOPES, createdAt: '2026-11-17T04:00:00.000Z' });

      const getAccessToken = (await createGetAccessToken({ config: CONFIG, store, fetch: google.fetch, now: () => NOW }))._unsafeUnwrap();

      expect((await getAccessToken())._unsafeUnwrapErr()).toBeInstanceOf(GoogleAuthError);
    });
  });

  describe('createAuthService', () => {
    // An owned loopback double that answers with a code and records how it was started and whether it was disposed.
    const ownedLoopback = () => {
      const state: { disposed: boolean; started: LoopbackServerOptions[] } = { disposed: false, started: [] };
      const start = (options: LoopbackServerOptions) => {
        state.started.push(options);
        const owned: OwnedLoopbackServer = {
          ...fakeLoopback(okAsync({ kind: 'code', code: 'code-1' })),
          [Symbol.asyncDispose]: async () => {
            state.disposed = true;
          },
        };
        return okAsync(owned);
      };
      return { start, state };
    };

    const serviceDeps = (overrides: Partial<AuthServiceDeps>): AuthServiceDeps => ({
      config: ok(CONFIG),
      store,
      fetch: tokenEndpoint().fetch,
      now: () => NOW,
      scopes: SCOPES,
      createState: () => 'state-1',
      openBrowser: noBrowser,
      startLoopback: ownedLoopback().start,
      ...overrides,
    });

    const LOGIN_OPTIONS = { signal: AbortSignal.timeout(5_000), print: () => undefined };

    it('exposes the credential path', () => {
      expect(createAuthService(serviceDeps({})).credentialPath).toBe(store.path);
    });

    it('reports logged-out status', async () => {
      expect((await createAuthService(serviceDeps({})).status())._unsafeUnwrap()).toEqual({ kind: 'logged-out', credentialPath: store.path });
    });

    it('reports logged-in status with scopes and time, never the refresh token', async () => {
      await store.write({ refreshToken: 'refresh-1', scope: SCOPES, createdAt: '2026-11-17T04:00:00.000Z' });

      const status = (await createAuthService(serviceDeps({})).status())._unsafeUnwrap();

      expect(status).toEqual({ kind: 'logged-in', credentialPath: store.path, scopes: SCOPES, loggedInAt: '2026-11-17T04:00:00.000Z' });
      expect(JSON.stringify(status)).not.toContain('refresh-1');
    });

    it('fails to start a login with ConfigError, without starting a loopback, when the client is not configured', async () => {
      const fake = ownedLoopback();
      const service = createAuthService(serviceDeps({ config: err(new ConfigError('Missing GOOGLE_CLIENT_ID')), startLoopback: fake.start }));

      expect((await service.startLogin(LOGIN_OPTIONS))._unsafeUnwrapErr()).toBeInstanceOf(ConfigError);
      expect(fake.state.started).toEqual([]);
    });

    it('starts the loopback expecting the generated state under the caller signal', async () => {
      const fake = ownedLoopback();
      const signal = AbortSignal.timeout(5_000);

      await createAuthService(serviceDeps({ startLoopback: fake.start })).startLogin({ signal, print: () => undefined });

      expect(fake.state.started).toEqual([{ expectedState: 'state-1', signal }]);
    });

    it('completes a login with a summary that carries no secret, and disposes the loopback with the session', async () => {
      const fake = ownedLoopback();
      const service = createAuthService(serviceDeps({ startLoopback: fake.start }));

      const session = (await service.startLogin(LOGIN_OPTIONS))._unsafeUnwrap();
      const summary = (await session.complete())._unsafeUnwrap();
      expect(fake.state.disposed).toBe(false);
      await session[Symbol.asyncDispose]();

      expect(summary).toEqual({ credentialPath: store.path, scopes: SCOPES, loggedInAt: '2026-11-17T04:00:00.000Z' });
      expect(JSON.stringify(summary)).not.toContain('refresh-1');
      expect(fake.state.disposed).toBe(true);
    });

    it('logs out', async () => {
      await store.write({ refreshToken: 'refresh-1', scope: SCOPES, createdAt: '2026-11-17T04:00:00.000Z' });

      expect((await createAuthService(serviceDeps({})).logout())._unsafeUnwrap()).toEqual({ kind: 'logged-out', revocation: { kind: 'revoked' } });
    });

    it('fails getAccessToken with ConfigError when the client is not configured', async () => {
      const service = createAuthService(serviceDeps({ config: err(new ConfigError('Missing GOOGLE_CLIENT_ID')) }));

      expect((await service.getAccessToken())._unsafeUnwrapErr()).toBeInstanceOf(ConfigError);
    });

    it('fails getAccessToken with NotLoggedInError when nothing is stored', async () => {
      expect((await createAuthService(serviceDeps({})).getAccessToken())._unsafeUnwrapErr()).toBeInstanceOf(NotLoggedInError);
    });
  });
});
