import { GOOGLE_SCOPES } from '@napolab/gct-core/scopes';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ConfigError, LoginTimeoutError } from '../../context/errors';
import { FAKE_CREDENTIAL_PATH, fakeAuth, fakeContext } from '../../test-support';

import { formatLogin, runLogin } from './index';

import type { LoginOptions, LoginSession, LoginSummary } from '../../context';

const SUMMARY: LoginSummary = { credentialPath: FAKE_CREDENTIAL_PATH, scopes: [GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.tasks], loggedInAt: '2026-11-17T01:00:00.000Z' };

// A LoginSession double started by a fake auth service: records the start options and whether its owner disposed it.
const fakeLogin = (complete: LoginSession['complete']) => {
  const state: { disposed: boolean; options: LoginOptions[] } = { disposed: false, options: [] };
  const session: LoginSession = {
    complete,
    [Symbol.asyncDispose]: async () => {
      state.disposed = true;
    },
  };
  const startLogin = (options: LoginOptions) => {
    state.options.push(options);
    options.print('Open this URL in your browser: https://accounts.google.com/o/oauth2/v2/auth?...');
    return okAsync(session);
  };
  return { startLogin, state };
};

describe('formatLogin', () => {
  it('confirms the login with scopes and where the credentials went', () => {
    const text = formatLogin(SUMMARY);
    expect(text).toContain('Logged in');
    expect(text).toContain(GOOGLE_SCOPES.tasks);
    expect(text).toContain(FAKE_CREDENTIAL_PATH);
  });
});

describe('runLogin', () => {
  it('starts the login under a live deadline, prints progress to stderr, completes it and disposes the session', async () => {
    const fake = fakeLogin(() => okAsync(SUMMARY));
    const ctx = fakeContext({ auth: fakeAuth({ startLogin: fake.startLogin }) });

    await runLogin(ctx, {}, []);

    expect(fake.state.options[0]?.signal.aborted).toBe(false);
    expect(ctx.output.stderr.join('\n')).toContain('https://accounts.google.com/');
    expect(ctx.output.stdout).toEqual([formatLogin(SUMMARY)]);
    expect(fake.state.disposed).toBe(true);
  });

  it('disposes the session when the login fails', async () => {
    const fake = fakeLogin(() => errAsync(new LoginTimeoutError('The browser did not come back in time.')));
    const ctx = fakeContext({ auth: fakeAuth({ startLogin: fake.startLogin }) });

    await runLogin(ctx, {}, []);

    expect(ctx.output.stderr.join('\n')).toContain('LoginTimeoutError');
    expect(ctx.output.failed()).toBe(true);
    expect(fake.state.disposed).toBe(true);
  });

  it('fails when the login cannot start', async () => {
    const ctx = fakeContext({ auth: fakeAuth({ startLogin: () => errAsync(new ConfigError('Missing GOOGLE_CLIENT_ID')) }) });

    await runLogin(ctx, {}, []);

    expect(ctx.output.stderr.join('\n')).toContain('ConfigError');
    expect(ctx.output.failed()).toBe(true);
  });
});
