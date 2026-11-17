import { GoogleAuthError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { GoogleNotConnectedError, GoogleReconnectRequiredError, OAuthStateError } from '../../errors';
import { createTokenVault } from './index';

import type { VaultStorage } from './index';

const NOW = 1_700_000_000_000;
const CALENDAR = 'https://www.googleapis.com/auth/calendar';
const TASKS = 'https://www.googleapis.com/auth/tasks';

const memoryStorage = () => {
  const data = new Map<string, unknown>();
  const storage: VaultStorage = {
    get: async (key) => data.get(key),
    put: async (key, value) => {
      data.set(key, structuredClone(value));
    },
    delete: async (keys) => keys.filter((key) => data.delete(key)).length,
  };
  return { storage, data };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Call = { url: string; form: Record<string, string> };

const fakeFetch = (respond: (call: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = { url: `${input instanceof Request ? input.url : input}`, form: Object.fromEntries(new URLSearchParams(`${init?.body ?? ''}`)) };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
};

const tokenResponse = (accessToken: string) => json({ access_token: accessToken, expires_in: 3600, scope: `${CALENDAR} ${TASKS}`, token_type: 'Bearer' });

const setup = (respond: (call: Call) => Response | Promise<Response> = () => tokenResponse('access-new')) => {
  const { storage, data } = memoryStorage();
  const fake = fakeFetch(respond);
  const clock = { now: NOW };
  const vault = createTokenVault({ storage, fetch: fake.fetch, now: () => clock.now, clientId: 'client-1', clientSecret: 'secret-1' });
  return { vault, data, calls: fake.calls, clock };
};

const connect = (vault: ReturnType<typeof setup>['vault'], refreshToken = 'refresh-1', expiresAt = NOW + 3_600_000) =>
  vault.saveConnection({ refreshToken, accessToken: 'access-1', expiresAt, scopes: [CALENDAR, TASKS] });

describe('status', () => {
  it('is disconnected before any connection', async () => {
    const { vault } = setup();

    expect((await vault.status())._unsafeUnwrap()).toEqual({ kind: 'disconnected' });
  });

  it('reports the scopes and the time of a saved connection', async () => {
    const { vault } = setup();
    await connect(vault);

    expect((await vault.status())._unsafeUnwrap()).toEqual({ kind: 'connected', scopes: [CALENDAR, TASKS], connectedAt: NOW });
  });
});

describe('authorization state', () => {
  it('hands back the PKCE verifier once for the state it stored', async () => {
    const { vault } = setup();
    await vault.startAuthorization({ state: 'state-1', codeVerifier: 'verifier-1' });

    expect((await vault.consumeAuthorization('state-1'))._unsafeUnwrap()).toBe('verifier-1');
    expect((await vault.consumeAuthorization('state-1'))._unsafeUnwrapErr()).toEqual(new OAuthStateError('missing'));
  });

  it('drops the pending authorization on a mismatching state too', async () => {
    const { vault } = setup();
    await vault.startAuthorization({ state: 'state-1', codeVerifier: 'verifier-1' });

    expect((await vault.consumeAuthorization('forged'))._unsafeUnwrapErr()).toEqual(new OAuthStateError('mismatch'));
    expect((await vault.consumeAuthorization('state-1'))._unsafeUnwrapErr()).toEqual(new OAuthStateError('missing'));
  });

  it('rejects a state older than 10 minutes', async () => {
    const { vault, clock } = setup();
    await vault.startAuthorization({ state: 'state-1', codeVerifier: 'verifier-1' });
    clock.now = NOW + 10 * 60_000;

    expect((await vault.consumeAuthorization('state-1'))._unsafeUnwrapErr()).toEqual(new OAuthStateError('expired'));
  });
});

describe('getAccessToken', () => {
  it('fails with GoogleNotConnectedError before any connection, without calling Google', async () => {
    const { vault, calls } = setup();

    expect((await vault.getAccessToken())._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotConnectedError);
    expect(calls).toEqual([]);
  });

  it('hands out the access token saved with the connection while it is fresh', async () => {
    const { vault, calls } = setup();
    await connect(vault);

    expect((await vault.getAccessToken())._unsafeUnwrap()).toBe('access-1');
    expect(calls).toEqual([]);
  });

  it('refreshes with the stored refresh token near the expiry and caches the new token in storage', async () => {
    const { vault, calls, clock } = setup();
    await connect(vault, 'refresh-1', NOW + 120_000);
    clock.now = NOW + 61_000;

    expect((await vault.getAccessToken())._unsafeUnwrap()).toBe('access-new');
    expect(calls.map((call) => call.form)).toEqual([{ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: 'client-1', client_secret: 'secret-1' }]);

    expect((await vault.getAccessToken())._unsafeUnwrap()).toBe('access-new');
    expect(calls).toHaveLength(1);
  });

  it('coalesces concurrent refreshes into one request', async () => {
    const { vault, calls } = setup();
    await connect(vault, 'refresh-1', NOW);

    const tokens = await Promise.all([vault.getAccessToken(), vault.getAccessToken(), vault.getAccessToken()]);

    expect(tokens.map((token) => token._unsafeUnwrap())).toEqual(['access-new', 'access-new', 'access-new']);
    expect(calls).toHaveLength(1);
  });

  it('drops the connection and asks for a reconnect on invalid_grant', async () => {
    const { vault } = setup(() => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400));
    await connect(vault, 'refresh-1', NOW);

    const error = (await vault.getAccessToken())._unsafeUnwrapErr();

    expect(error).toBeInstanceOf(GoogleReconnectRequiredError);
    expect(error.message).not.toContain('refresh-1');
    expect((await vault.status())._unsafeUnwrap()).toEqual({ kind: 'disconnected' });
  });

  it('keeps the connection on other refresh failures and retries next time', async () => {
    const responses = [json({ error: 'server_error' }, 500), tokenResponse('access-new')];
    const { vault, calls } = setup(() => responses.shift() ?? tokenResponse('unexpected'));
    await connect(vault, 'refresh-1', NOW);

    const error = (await vault.getAccessToken())._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error).not.toBeInstanceOf(GoogleReconnectRequiredError);

    expect((await vault.getAccessToken())._unsafeUnwrap()).toBe('access-new');
    expect(calls).toHaveLength(2);
  });

  it('does not let a refresh that finishes after a reconnect overwrite or drop the new connection', async () => {
    const pending: Array<(response: Response) => void> = [];
    const { vault, data } = setup(() => new Promise((resolve) => pending.push(resolve)));
    await connect(vault, 'refresh-1', NOW);

    const inFlight = vault.getAccessToken();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await connect(vault, 'refresh-2', NOW + 3_600_000);
    pending[0]?.(json({ error: 'invalid_grant' }, 400));
    await inFlight;

    expect((await vault.status())._unsafeUnwrap()).toMatchObject({ kind: 'connected' });
    expect(data.get('access-token')).toEqual({ accessToken: 'access-1', expiresAt: NOW + 3_600_000, refreshToken: 'refresh-2' });
    expect((await vault.getAccessToken())._unsafeUnwrap()).toBe('access-1');
  });
});

describe('disconnect', () => {
  it('revokes the refresh token at Google and forgets the connection', async () => {
    const { vault, calls, data } = setup(() => new Response(null, { status: 200 }));
    await connect(vault);

    expect((await vault.disconnect())._unsafeUnwrap()).toEqual({ kind: 'revoked' });
    expect(calls).toEqual([{ url: 'https://oauth2.googleapis.com/revoke', form: { token: 'refresh-1' } }]);
    expect([...data.keys()]).toEqual([]);
  });

  it('forgets the connection even when the revocation fails', async () => {
    const { vault, data } = setup(() => json({ error: 'invalid_token' }, 400));
    await connect(vault);

    const disconnection = (await vault.disconnect())._unsafeUnwrap();

    expect(disconnection.kind).toBe('revoke-failed');
    expect([...data.keys()]).toEqual([]);
  });

  it('reports not-connected without calling Google', async () => {
    const { vault, calls } = setup();

    expect((await vault.disconnect())._unsafeUnwrap()).toEqual({ kind: 'not-connected' });
    expect(calls).toEqual([]);
  });
});
