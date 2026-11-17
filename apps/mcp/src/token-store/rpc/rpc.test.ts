import { GoogleAuthError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { GoogleNotConnectedError, GoogleReconnectRequiredError, OAuthStateError, TokenStoreUnavailableError } from '../../errors';
import { createTokenStoreClient, createTokenStoreRPC } from './index';

import type { TokenVault } from '../vault';
import type { TokenStoreRPC } from './index';

const vaultWith = (overrides: Partial<TokenVault>): TokenVault => ({
  status: () => okAsync({ kind: 'disconnected' }),
  startAuthorization: () => okAsync(undefined),
  consumeAuthorization: () => okAsync('verifier-1'),
  saveConnection: () => okAsync(undefined),
  getAccessToken: () => okAsync('access-1'),
  disconnect: () => okAsync({ kind: 'not-connected' }),
  ...overrides,
});

// The DO side and the Worker side wired back to back, the way a DO stub connects them.
const roundTrip = (overrides: Partial<TokenVault>) => createTokenStoreClient(createTokenStoreRPC(vaultWith(overrides)));

describe('token store RPC', () => {
  it('replies with plain, structured-cloneable values', async () => {
    const rpc = createTokenStoreRPC(vaultWith({ getAccessToken: () => errAsync(new GoogleReconnectRequiredError('expired')) }));

    const reply = await rpc.getAccessToken();

    expect(reply).toEqual({ kind: 'reconnect-required', message: 'expired' });
    expect(structuredClone(reply)).toEqual(reply);
  });

  it('carries an access token', async () => {
    expect((await roundTrip({}).getAccessToken())._unsafeUnwrap()).toBe('access-1');
  });

  it.each([
    ['not connected', new GoogleNotConnectedError('nope'), GoogleNotConnectedError],
    ['reconnect required', new GoogleReconnectRequiredError('expired'), GoogleReconnectRequiredError],
    ['another auth failure', new GoogleAuthError('server_error'), GoogleAuthError],
  ])('rebuilds the %s error class on the Worker side', async (_label, error, expected) => {
    const result = await roundTrip({ getAccessToken: () => errAsync(error) }).getAccessToken();

    const rebuilt = result._unsafeUnwrapErr();
    expect(rebuilt).toBeInstanceOf(expected);
    expect(rebuilt.message).toBe(error.message);
  });

  it('keeps a plain GoogleAuthError distinct from the connection errors', async () => {
    const rebuilt = (await roundTrip({ getAccessToken: () => errAsync(new GoogleAuthError('server_error')) }).getAccessToken())._unsafeUnwrapErr();

    expect(rebuilt).not.toBeInstanceOf(GoogleNotConnectedError);
    expect(rebuilt).not.toBeInstanceOf(GoogleReconnectRequiredError);
  });

  it('rebuilds an OAuth state rejection with its problem', async () => {
    const result = await roundTrip({ consumeAuthorization: () => errAsync(new OAuthStateError('expired')) }).consumeAuthorization('state-1');

    expect(result._unsafeUnwrapErr()).toEqual(new OAuthStateError('expired'));
  });

  it('passes status, connection, start and disconnect through', async () => {
    const saved: unknown[] = [];
    const store = roundTrip({
      status: () => okAsync({ kind: 'connected', scopes: ['s'], connectedAt: 1 }),
      saveConnection: (connection) => {
        saved.push(connection);
        return okAsync(undefined);
      },
      disconnect: () => okAsync({ kind: 'revoked' }),
    });

    expect((await store.status())._unsafeUnwrap()).toEqual({ kind: 'connected', scopes: ['s'], connectedAt: 1 });
    expect((await store.saveConnection({ refreshToken: 'r', accessToken: 'a', expiresAt: 2, scopes: ['s'] })).isOk()).toBe(true);
    expect(saved).toEqual([{ refreshToken: 'r', accessToken: 'a', expiresAt: 2, scopes: ['s'] }]);
    expect((await store.startAuthorization({ state: 's', codeVerifier: 'v' })).isOk()).toBe(true);
    expect((await store.disconnect())._unsafeUnwrap()).toEqual({ kind: 'revoked' });
  });

  it('maps a failing DO call to TokenStoreUnavailableError (GoogleAuthError for getAccessToken)', async () => {
    const broken: TokenStoreRPC = {
      status: () => Promise.reject(new Error('DO reset')),
      startAuthorization: () => Promise.reject(new Error('DO reset')),
      consumeAuthorization: () => Promise.reject(new Error('DO reset')),
      saveConnection: () => Promise.reject(new Error('DO reset')),
      getAccessToken: () => Promise.reject(new Error('DO reset')),
      disconnect: () => Promise.reject(new Error('DO reset')),
    };
    const store = createTokenStoreClient(broken);

    expect((await store.status())._unsafeUnwrapErr()).toBeInstanceOf(TokenStoreUnavailableError);
    expect((await store.consumeAuthorization('s'))._unsafeUnwrapErr()).toBeInstanceOf(TokenStoreUnavailableError);
    expect((await store.disconnect())._unsafeUnwrapErr()).toBeInstanceOf(TokenStoreUnavailableError);
    expect((await store.getAccessToken())._unsafeUnwrapErr()).toBeInstanceOf(GoogleAuthError);
  });
});
