import { describe, expect, it } from 'vitest';

import { CALLBACK_PATH, createCallbackApp } from './index';

import type { LoginCallback } from './index';

const STATE = 'state-123';

const appWith = () => {
  const received: LoginCallback[] = [];
  const app = createCallbackApp({ expectedState: STATE, onCallback: (callback) => received.push(callback) });
  return { app, received };
};

describe('createCallbackApp', () => {
  it('hands a valid redirect to onCallback and renders the success page', async () => {
    const { app, received } = appWith();

    const response = await app.request(`/callback?state=${STATE}&code=code-1`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    const body = await response.text();
    expect(body.startsWith('<!doctype html>')).toBe(true);
    expect(body).toContain('close this tab');
    expect(received).toEqual([{ kind: 'code', code: 'code-1' }]);
  });

  it('never caches the callback page', async () => {
    const { app } = appWith();

    const response = await app.request(`/callback?state=${STATE}&code=code-1`);

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('hands a Google error to onCallback and answers 200', async () => {
    const { app, received } = appWith();

    const response = await app.request(`/callback?state=${STATE}&error=access_denied`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('access_denied');
    expect(received).toEqual([{ kind: 'error', error: 'access_denied' }]);
  });

  it('hands a state mismatch to onCallback and answers 400', async () => {
    const { app, received } = appWith();

    const response = await app.request('/callback?state=forged&code=code-1');

    expect(response.status).toBe(400);
    expect(received).toEqual([{ kind: 'invalid', reason: 'state-mismatch' }]);
  });

  it.each(['/', '/favicon.ico', '/callback/extra'])('answers 404 for %s without touching the login', async (path) => {
    const { app, received } = appWith();

    const response = await app.request(`${path}?state=${STATE}&code=code-1`);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Not found');
    expect(received).toEqual([]);
  });

  it('answers 404 for non-GET requests on the callback path', async () => {
    const { app, received } = appWith();

    const response = await app.request(`/callback?state=${STATE}&code=code-1`, { method: 'POST' });

    expect(response.status).toBe(404);
    expect(received).toEqual([]);
  });

  // The redirect's query, as Google (or anyone else) may send it.
  describe('query validation', () => {
    const redirect = async (search: string) => {
      const { app, received } = appWith();
      const response = await app.request(`${CALLBACK_PATH}?${search}`);
      return { status: response.status, body: await response.text(), received };
    };

    it('serves the redirect on /callback', () => {
      expect(CALLBACK_PATH).toBe('/callback');
    });

    it('extracts the authorization code when the state matches, ignoring extra parameters', async () => {
      expect((await redirect(`state=${STATE}&code=4/abc&scope=x`)).received).toEqual([{ kind: 'code', code: '4/abc' }]);
    });

    it.each([
      ['a different state', 'state=other&code=abc'],
      ['no state', 'code=abc'],
      ['an empty state', 'state=&code=abc'],
      ['a forged state on a Google error', 'error=access_denied&state=other'],
      ['no state on a Google error', 'error=access_denied'],
      ['neither code nor error and a different state', 'state=other'],
    ])('rejects %s as a state mismatch with 400', async (_, search) => {
      const result = await redirect(search);
      expect(result.status).toBe(400);
      expect(result.received).toEqual([{ kind: 'invalid', reason: 'state-mismatch' }]);
    });

    it.each([
      ['no code', `state=${STATE}`],
      ['an empty code', `state=${STATE}&code=`],
    ])('rejects a matching-state redirect with %s as missing-code with 400', async (_, search) => {
      const result = await redirect(search);
      expect(result.status).toBe(400);
      expect(result.received).toEqual([{ kind: 'invalid', reason: 'missing-code' }]);
    });

    it('prefers the Google error over a code', async () => {
      expect((await redirect(`state=${STATE}&error=access_denied&code=abc`)).received).toEqual([{ kind: 'error', error: 'access_denied' }]);
    });

    it('never echoes a rejected query back into the page', async () => {
      const result = await redirect('state=%3Cscript%3Eforged&code=%3Cb%3Esecret-code');
      expect(result.body).not.toContain('forged');
      expect(result.body).not.toContain('secret-code');
    });
  });
});
