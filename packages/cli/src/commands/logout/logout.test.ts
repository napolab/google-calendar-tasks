import { GoogleNetworkError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { CredentialStoreError } from '../../context/errors';
import { FAKE_CREDENTIAL_PATH, fakeAuth, fakeContext } from '../../test-support';

import { formatLogout, runLogout, toLogoutReport } from './index';

describe('toLogoutReport', () => {
  it('reports nothing to do when not logged in', () => {
    expect(toLogoutReport({ kind: 'not-logged-in' }, FAKE_CREDENTIAL_PATH)).toEqual({ kind: 'not-logged-in', credentialPath: FAKE_CREDENTIAL_PATH });
  });

  it('describes a failed revocation as text', () => {
    expect(toLogoutReport({ kind: 'logged-out', revocation: { kind: 'revoke-failed', error: new GoogleNetworkError('offline') } }, FAKE_CREDENTIAL_PATH)).toEqual({
      kind: 'logged-out',
      credentialPath: FAKE_CREDENTIAL_PATH,
      revocation: { kind: 'revoke-failed', reason: 'GoogleNetworkError: offline' },
    });
  });
});

describe('formatLogout', () => {
  it('confirms revocation and deletion', () => {
    const text = formatLogout({ kind: 'logged-out', credentialPath: FAKE_CREDENTIAL_PATH, revocation: { kind: 'revoked' } });
    expect(text).toContain('Logged out');
    expect(text).toContain(FAKE_CREDENTIAL_PATH);
  });

  it('says the token was only deleted locally when revocation failed', () => {
    expect(formatLogout({ kind: 'logged-out', credentialPath: FAKE_CREDENTIAL_PATH, revocation: { kind: 'revoke-failed', reason: 'GoogleNetworkError: offline' } })).toContain(
      'GoogleNetworkError: offline',
    );
  });

  it('says there was nothing to do', () => {
    expect(formatLogout({ kind: 'not-logged-in', credentialPath: FAKE_CREDENTIAL_PATH })).toContain('Not logged in');
  });
});

describe('runLogout', () => {
  it('logs out and prints the result', async () => {
    const ctx = fakeContext({ auth: fakeAuth({ logout: () => okAsync({ kind: 'logged-out', revocation: { kind: 'revoked' } }) }) });
    await runLogout(ctx, {}, []);
    expect(ctx.output.stdout.join('\n')).toContain('Logged out');
    expect(ctx.output.failed()).toBe(false);
  });

  it('prints JSON', async () => {
    const ctx = fakeContext();
    await runLogout(ctx, { json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual({ kind: 'not-logged-in', credentialPath: FAKE_CREDENTIAL_PATH });
  });

  it('fails when the credentials cannot be deleted', async () => {
    const ctx = fakeContext({ auth: fakeAuth({ logout: () => errAsync(new CredentialStoreError('Could not delete')) }) });
    await runLogout(ctx, {}, []);
    expect(ctx.output.failed()).toBe(true);
  });
});
