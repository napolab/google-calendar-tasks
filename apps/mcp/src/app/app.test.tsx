import { toCodeChallenge } from '@napolab/gct-core/oauth';
import { GOOGLE_SCOPES } from '@napolab/gct-core/scopes';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ACCESS_ASSERTION_HEADER } from '../access-auth';
import { InvalidAccessAssertion } from '../errors';
import { createTokenStoreRPC } from '../token-store/rpc';
import { createTokenVault } from '../token-store/vault';
import { readRPCBody, toolText } from '../test-support';
import { createApp } from './index';

import type { VerifyAccessToken } from '../access-auth';
import type { AppBindings } from '../hono-env';
import type { TokenStoreRPC } from '../token-store/rpc';
import type { VaultStorage } from '../token-store/vault';

const NOW = Date.UTC(2026, 10, 17, 3, 0, 0);
const EMAIL = 'owner@example.com';
const ORIGIN = 'http://localhost';
const REDIRECT_URI = 'https://gct.example.com/google/callback';
const BOTH = `${GOOGLE_SCOPES.calendar} ${GOOGLE_SCOPES.tasks}`;

type GoogleCall = { url: string; method: string; form: Record<string, string>; authorization: string | null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// A fake Google: token endpoint, revoke endpoint and the calendar list.
type RefreshOutcome = 'ok' | 'invalid_grant';

const fakeGoogle = (grantedScope: string, refresh: RefreshOutcome) => {
  const calls: GoogleCall[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = `${input instanceof Request ? input.url : input}`;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      form: Object.fromEntries(new URLSearchParams(typeof init?.body === 'string' ? init.body : '')),
      authorization: new Headers(init?.headers).get('authorization'),
    });
    if (url === 'https://oauth2.googleapis.com/token') return tokenEndpoint(calls.at(-1)?.form['grant_type'], grantedScope, refresh);
    if (url === 'https://oauth2.googleapis.com/revoke') return new Response(null, { status: 200 });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) return json({ items: [{ id: 'primary-id', summary: 'Me', primary: true, accessRole: 'owner' }] });
    return json({ error: { message: 'unexpected' } }, 500);
  };
  return { fetch, calls };
};

const tokenEndpoint = (grantType: string | undefined, grantedScope: string, refresh: RefreshOutcome): Response => {
  if (grantType === 'authorization_code') return json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: grantedScope, token_type: 'Bearer' });
  if (refresh === 'invalid_grant') return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
  return json({ access_token: 'access-2', expires_in: 3600, scope: grantedScope, token_type: 'Bearer' });
};

const memoryStorage = (): VaultStorage => {
  const data = new Map<string, unknown>();
  return {
    get: async (key) => data.get(key),
    put: async (key, value) => {
      data.set(key, structuredClone(value));
    },
    delete: async (keys) => keys.filter((key) => data.delete(key)).length,
  };
};

const setup = (options: { grantedScope?: string; refresh?: RefreshOutcome; verify?: VerifyAccessToken; env?: Partial<AppBindings> } = {}) => {
  const google = fakeGoogle(options.grantedScope ?? BOTH, options.refresh ?? 'ok');
  const stores = new Map<string, TokenStoreRPC>();
  const clock = { now: NOW };
  const now = () => clock.now;
  const deps = { fetch: google.fetch, now, clientId: 'client-1', clientSecret: 'secret-1' };
  const env: AppBindings = {
    CF_ACCESS_TEAM_DOMAIN: 'team',
    CF_ACCESS_AUD: 'aud-1',
    GOOGLE_CLIENT_ID: 'client-1',
    GOOGLE_CLIENT_SECRET: 'secret-1',
    GOOGLE_REDIRECT_URI: REDIRECT_URI,
    GOOGLE_TOKEN_STORE: {
      getByName: (name) => {
        const existing = stores.get(name);
        if (existing !== undefined) return existing;
        const created = createTokenStoreRPC(createTokenVault({ ...deps, storage: memoryStorage() }));
        stores.set(name, created);
        return created;
      },
    },
    ...options.env,
  };
  const verify: VerifyAccessToken = options.verify ?? ((token) => (token === 'valid' ? okAsync({ email: EMAIL }) : errAsync(new InvalidAccessAssertion('bad'))));
  const app = createApp({ verifyAccess: verify, fetch: google.fetch, now });
  const request = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { [ACCESS_ASSERTION_HEADER]: 'valid', ...init.headers } }, env);
  return { app, env, request, google, stores, clock };
};

const startConnect = async (request: ReturnType<typeof setup>['request']) => {
  const response = await request('/google/connect');
  const location = new URL(response.headers.get('location') ?? '');
  return { response, location, state: location.searchParams.get('state') ?? '' };
};

const mcp = (request: ReturnType<typeof setup>['request'], body: unknown) =>
  request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });

describe('access', () => {
  it('answers 403 without a valid Access assertion on every route', async () => {
    const { app, env } = setup();

    for (const path of ['/', '/google/connect', '/mcp']) {
      const response = await app.request(path, {}, env);
      expect(response.status).toBe(403);
    }
  });

  it('fails closed with 500 when Access is not configured', async () => {
    const { request } = setup({ env: { CF_ACCESS_AUD: '' } });

    expect((await request('/')).status).toBe(500);
  });

  it('uses one token store per Access email', async () => {
    const { request, stores } = setup();

    await request('/');

    expect([...stores.keys()]).toEqual([EMAIL]);
  });
});

describe('GET /', () => {
  it('offers to connect Google when not connected', async () => {
    const { request } = setup();

    const response = await request('/');
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body.startsWith('<!doctype html>')).toBe(true);
    expect(body).toContain(EMAIL);
    expect(body).toContain('href="/google/connect"');
    expect(body).toContain(`${ORIGIN}/mcp`);
  });
});

describe('GET /google/connect', () => {
  it('redirects to Google consent for Calendar + Tasks with PKCE, offline access and the Access email as hint', async () => {
    const { request } = setup();

    const { response, location, state } = await startConnect(request);

    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const params = Object.fromEntries(location.searchParams);
    expect(params).toMatchObject({
      client_id: 'client-1',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: BOTH,
      access_type: 'offline',
      prompt: 'consent',
      login_hint: EMAIL,
      code_challenge_method: 'S256',
    });
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(params['code_challenge']?.length).toBeGreaterThan(0);
  });
});

describe('GET /google/callback', () => {
  it('exchanges the code with the stored PKCE verifier, saves the connection and shows success', async () => {
    const { request, google } = setup();
    const { location, state } = await startConnect(request);

    const response = await request(`/google/callback?code=code-1&state=${state}&scope=${encodeURIComponent(BOTH)}`);

    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/connected/i);
    const [exchange] = google.calls;
    expect(exchange?.url).toBe('https://oauth2.googleapis.com/token');
    expect(exchange?.form).toMatchObject({ grant_type: 'authorization_code', code: 'code-1', redirect_uri: REDIRECT_URI, client_id: 'client-1', client_secret: 'secret-1' });
    expect(await toCodeChallenge(exchange?.form['code_verifier'] ?? '')).toBe(location.searchParams.get('code_challenge'));

    const status = await (await request('/')).text();
    expect(status).toContain('Google Calendar');
    expect(status).toContain('Google Tasks');
  });

  it('rejects a state that was not issued to this user, without calling Google', async () => {
    const { request, google } = setup();
    await startConnect(request);

    const response = await request('/google/callback?code=code-1&state=forged');

    expect(response.status).toBe(400);
    expect(google.calls).toEqual([]);
  });

  it('accepts a state only once', async () => {
    const { request } = setup();
    const { state } = await startConnect(request);

    expect((await request(`/google/callback?code=code-1&state=${state}`)).status).toBe(200);
    expect((await request(`/google/callback?code=code-1&state=${state}`)).status).toBe(400);
  });

  it('explains how to fix a grant without Tasks, revokes it and stays disconnected', async () => {
    const { request, google } = setup({ grantedScope: `openid ${GOOGLE_SCOPES.calendar}` });
    const { state } = await startConnect(request);

    const response = await request(`/google/callback?code=code-1&state=${state}`);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('Google Tasks');
    expect(body).toMatch(/checkbox/i);
    expect(google.calls.map((call) => call.url)).toContain('https://oauth2.googleapis.com/revoke');
    expect(await (await request('/')).text()).toContain('href="/google/connect"');
  });

  it('shows a fixed message for a Google error and never echoes the query', async () => {
    const { request } = setup();
    const { state } = await startConnect(request);
    const hostile = '<script>alert(1)</script>';

    const response = await request(`/google/callback?error=${encodeURIComponent(hostile)}&state=${state}`);
    const body = await response.text();

    expect(body).not.toContain(hostile);
    expect(body).not.toContain('alert(1)');
    expect(response.status).toBe(400);
  });

  it('treats access_denied as the user declining', async () => {
    const { request } = setup();
    const { state } = await startConnect(request);

    const response = await request(`/google/callback?error=access_denied&state=${state}`);

    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/declined|cancel/i);
  });

  it('answers a malformed callback with a fixed 400 page', async () => {
    const { request } = setup();

    const response = await request('/google/callback?foo=bar');

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await response.text()).not.toContain('foo');
  });
});

describe('POST /google/disconnect', () => {
  it('revokes, forgets the connection and returns to the status page', async () => {
    const { request, google } = setup();
    const { state } = await startConnect(request);
    await request(`/google/callback?code=code-1&state=${state}`);

    const response = await request('/google/disconnect', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, body: '' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(google.calls.at(-1)).toMatchObject({ url: 'https://oauth2.googleapis.com/revoke', form: { token: 'refresh-1' } });
    expect(await (await request('/')).text()).toContain('href="/google/connect"');
  });

  it('rejects a cross-site form post', async () => {
    const { request, google } = setup();

    const response = await request('/google/disconnect', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: '' });

    expect(response.status).toBe(403);
    expect(google.calls).toEqual([]);
  });
});

describe('/mcp', () => {
  it('lists the tools', async () => {
    const { request } = setup();

    const response = await mcp(request, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

    expect(response.status).toBe(200);
    expect((await readRPCBody(response)).result.tools).toHaveLength(17);
  });

  it('tells the LLM to send the user to the connect page (on this host) before Google is connected', async () => {
    const { request } = setup();

    const body = await readRPCBody(await mcp(request, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_calendars', arguments: {} } }));

    expect(body.result.isError).toBe(true);
    expect(toolText(body)).toContain(`${ORIGIN}/google/connect`);
  });

  it('calls Google with the stored access token once connected', async () => {
    const { request, google } = setup();
    const { state } = await startConnect(request);
    await request(`/google/callback?code=code-1&state=${state}`);

    const body = await readRPCBody(await mcp(request, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_calendars', arguments: {} } }));

    expect(body.result.isError).toBeUndefined();
    expect(JSON.parse(toolText(body))).toEqual({ calendars: [{ id: 'primary-id', summary: 'Me', primary: true, accessRole: 'owner', timeZone: null }] });
    expect(google.calls.at(-1)?.authorization).toBe('Bearer access-1');
  });

  it('refreshes an expired access token transparently', async () => {
    const { request, google, clock } = setup({ refresh: 'ok' });
    const { state } = await startConnect(request);
    await request(`/google/callback?code=code-1&state=${state}`);
    clock.now = NOW + 3_600_000;

    const body = await readRPCBody(await mcp(request, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_calendars', arguments: {} } }));

    expect(body.result.isError).toBeUndefined();
    expect(google.calls.at(-2)?.form).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1' });
    expect(google.calls.at(-1)?.authorization).toBe('Bearer access-2');
  });

  it('drops a revoked / expired grant and sends the user back to the connect page', async () => {
    const { request, clock } = setup({ refresh: 'invalid_grant' });
    const { state } = await startConnect(request);
    await request(`/google/callback?code=code-1&state=${state}`);
    clock.now = NOW + 7 * 24 * 3_600_000;

    const body = await readRPCBody(await mcp(request, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_calendars', arguments: {} } }));

    expect(body.result.isError).toBe(true);
    expect(toolText(body)).toContain(`${ORIGIN}/google/connect`);
    expect(toolText(body)).toMatch(/expired or was revoked/);
    expect(await (await request('/')).text()).toContain('href="/google/connect"');
  });
});
