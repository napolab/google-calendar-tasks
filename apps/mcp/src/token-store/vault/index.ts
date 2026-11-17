import { GoogleAuthError, GoogleInvalidGrantError } from '@napolab/gct-core/errors';
import { refreshAccessToken, revokeToken } from '@napolab/gct-core/oauth';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { z } from 'zod';

import { GoogleNotConnectedError, GoogleReconnectRequiredError } from '../../errors';
import { decideAccessToken } from '../access-token-cache';
import { checkPendingAuthorization, createPendingAuthorization } from '../pending-authorization';

import type { OAuthStateError } from '../../errors';
import type { CachedAccessToken } from '../access-token-cache';
import type { AuthorizationStart, PendingAuthorization } from '../pending-authorization';
import type { Fetch } from '@napolab/gct-core/google-client';
import type { AccessToken, Now, TokenEndpointError } from '@napolab/gct-core/oauth';

// The Google credentials of ONE Access user, kept in that user's Durable Object storage. Runtime-free: the DO
// passes its storage, fetch and clock in, so this is tested with an in-memory storage and a fake fetch.
//
// Storage keys: `connection` (refresh token, granted scopes, connectedAt), `access-token` (the cached access
// token, tied to the refresh token it came from) and `pending-authorization` (state + PKCE verifier, 10 min).
// Only the in-flight refresh lives in memory (an idle DO is evicted, so a memory cache would rarely hit).

// The subset of DurableObjectStorage the vault uses.
export interface VaultStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(keys: string[]): Promise<number>;
}

export type TokenVaultDeps = {
  readonly storage: VaultStorage;
  readonly fetch: Fetch;
  readonly now: Now;
  readonly clientId: string;
  readonly clientSecret: string;
};

export type ConnectionStatus = { readonly kind: 'disconnected' } | { readonly kind: 'connected'; readonly scopes: readonly string[]; readonly connectedAt: number };

// What a successful authorization-code exchange hands over.
export type NewConnection = { readonly refreshToken: string; readonly accessToken: string; readonly expiresAt: number; readonly scopes: readonly string[] };

export type Disconnection = { readonly kind: 'not-connected' } | { readonly kind: 'revoked' } | { readonly kind: 'revoke-failed'; readonly message: string };

export interface TokenVault {
  status(): ResultAsync<ConnectionStatus, never>;
  startAuthorization(start: AuthorizationStart): ResultAsync<void, never>;
  // Single use: the pending authorization is deleted whatever the outcome.
  consumeAuthorization(state: string): ResultAsync<string, OAuthStateError>;
  saveConnection(connection: NewConnection): ResultAsync<void, never>;
  getAccessToken(): ResultAsync<string, GoogleAuthError>;
  // The local connection is deleted even when Google refuses the revocation.
  disconnect(): ResultAsync<Disconnection, never>;
}

const KEYS = { connection: 'connection', accessToken: 'access-token', pending: 'pending-authorization' } as const;

const connectionSchema = z.object({ refreshToken: z.string().min(1), scopes: z.array(z.string()), connectedAt: z.number() });

type StoredConnection = z.output<typeof connectionSchema>;

const cachedAccessTokenSchema = z.object({ accessToken: z.string().min(1), expiresAt: z.number(), refreshToken: z.string().min(1) });

const pendingSchema = z.object({ state: z.string(), codeVerifier: z.string(), expiresAt: z.number() });

// A record that does not parse (absent, or written by an older version) reads as absent.
const parseOrUndefined =
  <S extends z.ZodType>(schema: S) =>
  (raw: unknown): z.output<S> | undefined => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  };

const toStatus = (connection: StoredConnection | undefined): ConnectionStatus =>
  connection === undefined ? { kind: 'disconnected' } : { kind: 'connected', scopes: connection.scopes, connectedAt: connection.connectedAt };

type InFlightRefresh = { readonly refreshToken: string; readonly request: ResultAsync<string, GoogleAuthError> };

const NOT_CONNECTED = 'Google is not connected for this user.';

const RECONNECT_REQUIRED = 'Google rejected the stored authorization (expired or revoked), so the connection was removed. Connect Google again.';

const toAuthError = (error: TokenEndpointError): GoogleAuthError =>
  error instanceof GoogleAuthError ? error : new GoogleAuthError(`Could not refresh the Google access token: ${error.message}`, { cause: error });

export const createTokenVault = (deps: TokenVaultDeps): TokenVault => {
  const { storage } = deps;
  // At most one refresh per refresh token at a time; concurrent callers share it.
  const inFlight: { current: InFlightRefresh | undefined } = { current: undefined };

  const read = <S extends z.ZodType>(key: string, schema: S): ResultAsync<z.output<S> | undefined, never> => ResultAsync.fromSafePromise(storage.get(key)).map(parseOrUndefined(schema));

  const write = (key: string, value: unknown): ResultAsync<void, never> => ResultAsync.fromSafePromise(storage.put(key, value));

  const remove = (keys: readonly string[]): ResultAsync<void, never> => ResultAsync.fromSafePromise(storage.delete([...keys])).map(() => undefined);

  const readConnection = (): ResultAsync<StoredConnection | undefined, never> => read(KEYS.connection, connectionSchema);

  // Writes / deletes only while `refreshToken` is still the stored connection: a refresh that finishes after a
  // disconnect or a reconnect must neither resurrect the old connection nor drop the new one.
  const whileCurrent = (refreshToken: string, action: () => ResultAsync<void, never>): ResultAsync<void, never> =>
    readConnection().andThen((connection) => (connection?.refreshToken === refreshToken ? action() : okAsync(undefined)));

  const cacheToken = (refreshToken: string, token: AccessToken): ResultAsync<void, never> =>
    whileCurrent(refreshToken, () => write(KEYS.accessToken, { accessToken: token.accessToken, expiresAt: token.expiresAt, refreshToken } satisfies CachedAccessToken));

  const dropConnection = (refreshToken: string): ResultAsync<void, never> => whileCurrent(refreshToken, () => remove([KEYS.connection, KEYS.accessToken]));

  const onRefreshError =
    (refreshToken: string) =>
    (error: TokenEndpointError): ResultAsync<never, GoogleAuthError> =>
      error instanceof GoogleInvalidGrantError
        ? dropConnection(refreshToken).andThen(() => errAsync(new GoogleReconnectRequiredError(RECONNECT_REQUIRED, { cause: error })))
        : errAsync(toAuthError(error));

  const clearInFlight = (request: ResultAsync<string, GoogleAuthError>): void => {
    if (inFlight.current?.request === request) inFlight.current = undefined;
  };

  const startRefresh = (refreshToken: string): ResultAsync<string, GoogleAuthError> => {
    const request: ResultAsync<string, GoogleAuthError> = refreshAccessToken({ fetch: deps.fetch, clientId: deps.clientId, clientSecret: deps.clientSecret, refreshToken, now: deps.now })
      .andThen((token) => cacheToken(refreshToken, token).map(() => token.accessToken))
      .orElse(onRefreshError(refreshToken))
      .andTee(() => clearInFlight(request))
      .orTee(() => clearInFlight(request));
    inFlight.current = { refreshToken, request };
    return request;
  };

  const refresh = (refreshToken: string): ResultAsync<string, GoogleAuthError> => (inFlight.current?.refreshToken === refreshToken ? inFlight.current.request : startRefresh(refreshToken));

  const tokenFor = (connection: StoredConnection): ResultAsync<string, GoogleAuthError> =>
    read(KEYS.accessToken, cachedAccessTokenSchema).andThen((cached) => {
      const decision = decideAccessToken(cached, connection.refreshToken, deps.now());
      switch (decision.kind) {
        case 'use':
          return okAsync(decision.accessToken);
        case 'refresh':
          return refresh(connection.refreshToken);
        default: {
          const _exhaustive: never = decision;
          throw new Error(`unhandled cache decision: ${JSON.stringify(_exhaustive)}`);
        }
      }
    });

  const revoke = (connection: StoredConnection): ResultAsync<Disconnection, never> =>
    revokeToken({ fetch: deps.fetch, token: connection.refreshToken })
      .map((): Disconnection => ({ kind: 'revoked' }))
      .orElse((error) => okAsync<Disconnection, never>({ kind: 'revoke-failed', message: error.message }));

  return {
    status: () => readConnection().map(toStatus),
    startAuthorization: (start) => write(KEYS.pending, createPendingAuthorization(start, deps.now()) satisfies PendingAuthorization),
    consumeAuthorization: (state) =>
      read(KEYS.pending, pendingSchema)
        .andThen((pending) => remove([KEYS.pending]).map(() => pending))
        .andThen((pending) => checkPendingAuthorization(pending, state, deps.now())),
    saveConnection: (connection) =>
      write(KEYS.connection, { refreshToken: connection.refreshToken, scopes: [...connection.scopes], connectedAt: deps.now() } satisfies StoredConnection).andThen(() =>
        write(KEYS.accessToken, { accessToken: connection.accessToken, expiresAt: connection.expiresAt, refreshToken: connection.refreshToken } satisfies CachedAccessToken),
      ),
    getAccessToken: () => readConnection().andThen((connection) => (connection === undefined ? errAsync(new GoogleNotConnectedError(NOT_CONNECTED)) : tokenFor(connection))),
    disconnect: () =>
      readConnection().andThen((connection) => {
        if (connection === undefined) return okAsync<Disconnection, never>({ kind: 'not-connected' });
        inFlight.current = undefined;
        return remove([KEYS.connection, KEYS.accessToken]).andThen(() => revoke(connection));
      }),
  };
};
