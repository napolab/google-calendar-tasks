import { GOOGLE_SCOPES } from '@napolab/gct-core/scopes';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { CredentialStoreError } from '../../context/errors';
import { FAKE_CREDENTIAL_PATH, fakeAuth, fakeContext } from '../../test-support';

import { formatStatus, runStatus, toStatus } from './index';

import type { AuthStatus } from '../../context';

const PATH = FAKE_CREDENTIAL_PATH;
const LOGGED_IN: AuthStatus = { kind: 'logged-in', credentialPath: PATH, scopes: [GOOGLE_SCOPES.calendar], loggedInAt: '2026-11-17T01:00:00.000Z' };

describe('toStatus', () => {
  it('keeps a logged-out status as is', () => {
    expect(toStatus({ kind: 'logged-out', credentialPath: PATH })).toEqual({ kind: 'logged-out', credentialPath: PATH });
  });

  it('adds the scopes the CLI needs but the login did not grant', () => {
    expect(toStatus(LOGGED_IN)).toEqual({ ...LOGGED_IN, missingScopes: [GOOGLE_SCOPES.tasks] });
  });
});

describe('formatStatus', () => {
  it('tells a logged-out user to run gct login', () => {
    const text = formatStatus({ kind: 'logged-out', credentialPath: PATH });
    expect(text).toContain('Not logged in');
    expect(text).toContain('gct login');
    expect(text).toContain(PATH);
  });

  it('lists the scopes and flags missing ones', () => {
    const text = formatStatus({ ...LOGGED_IN, missingScopes: [GOOGLE_SCOPES.tasks] });
    expect(text).toContain('Logged in');
    expect(text).toContain(GOOGLE_SCOPES.calendar);
    expect(text).toContain(`Missing scopes: ${GOOGLE_SCOPES.tasks}`);
    expect(text).toContain('2026-11-17 10:00');
  });
});

describe('runStatus', () => {
  it('prints the status and succeeds when logged out', async () => {
    const ctx = fakeContext();
    await runStatus(ctx, {}, []);
    expect(ctx.output.stdout.join('\n')).toContain('Not logged in');
    expect(ctx.output.failed()).toBe(false);
  });

  it('prints JSON', async () => {
    const ctx = fakeContext({ auth: fakeAuth({ status: () => okAsync(LOGGED_IN) }) });
    await runStatus(ctx, { json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual({ ...LOGGED_IN, missingScopes: [GOOGLE_SCOPES.tasks] });
  });

  it('fails when the credentials file cannot be read', async () => {
    const ctx = fakeContext({ auth: fakeAuth({ status: () => errAsync(new CredentialStoreError(`${PATH} is corrupt.`)) }) });
    await runStatus(ctx, {}, []);
    expect(ctx.output.stderr.join('\n')).toContain('CredentialStoreError');
    expect(ctx.output.failed()).toBe(true);
  });

  it('rejects extra arguments', async () => {
    const ctx = fakeContext();
    await runStatus(ctx, {}, ['extra']);
    expect(ctx.output.failed()).toBe(true);
  });
});
