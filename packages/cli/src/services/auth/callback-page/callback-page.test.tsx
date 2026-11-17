import { describe, expect, it } from 'vitest';

import { CallbackPage } from './index';

import type { CallbackResult } from '../callback-app';

const render = async (result: CallbackResult): Promise<string> => `${await (<CallbackPage result={result} />).toString()}`;

describe('CallbackPage', () => {
  it('tells the user to close the tab after a successful login, without showing the code', async () => {
    const page = await render({ kind: 'code', code: 'secret-code' });

    expect(page).toContain('<title>Logged in to gct</title>');
    expect(page).toContain('close this tab');
    expect(page).not.toContain('secret-code');
  });

  it('shows the OAuth error code Google sent back', async () => {
    const page = await render({ kind: 'error', error: 'access_denied' });

    expect(page).toContain('Login was not completed');
    expect(page).toContain('access_denied');
  });

  it('escapes the error code (it comes from the request)', async () => {
    const page = await render({ kind: 'error', error: '<script>alert(1)</script>' });

    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;');
  });

  it.each([
    ['state-mismatch', 'did not match the login in progress'],
    ['missing-code', 'did not include an authorization code'],
  ] as const)('explains an invalid callback (%s)', async (reason, text) => {
    const page = await render({ kind: 'invalid', reason });

    expect(page).toContain('Invalid login callback');
    expect(page).toContain(text);
  });

  it('renders a not-found page for ignored requests', async () => {
    expect(await render({ kind: 'ignored' })).toContain('<title>Not found</title>');
  });
});
