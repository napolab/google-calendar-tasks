import { GoogleAuthError } from '@napolab/gct-core/errors';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';

import { GoogleNotConnectedError, GoogleReconnectRequiredError, OAuthStateError, TokenStoreUnavailableError } from '../../errors';

import type { OAuthStateProblem } from '../../errors';
import type { AuthorizationStart } from '../pending-authorization';
import type { ConnectionStatus, Disconnection, NewConnection, TokenVault } from '../vault';
import type { GetAccessToken } from '@napolab/gct-core/google-client';

// The Durable Object RPC boundary. Error classes do not survive structured cloning, so the DO side folds each
// ResultAsync into a plain tagged reply and the Worker side rebuilds the ResultAsync and its error classes.

export type AuthorizationReply = { readonly kind: 'ok'; readonly codeVerifier: string } | { readonly kind: 'rejected'; readonly problem: OAuthStateProblem };

export type AccessTokenReply =
  | { readonly kind: 'ok'; readonly accessToken: string }
  | { readonly kind: 'not-connected'; readonly message: string }
  | { readonly kind: 'reconnect-required'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

// What GoogleTokenStore exposes over RPC (the DO class implements it; a DO stub satisfies it).
export interface TokenStoreRPC {
  status(): Promise<ConnectionStatus>;
  startAuthorization(start: AuthorizationStart): Promise<void>;
  consumeAuthorization(state: string): Promise<AuthorizationReply>;
  saveConnection(connection: NewConnection): Promise<void>;
  getAccessToken(): Promise<AccessTokenReply>;
  disconnect(): Promise<Disconnection>;
}

// ---- DO side ----

const never = (value: never): never => value;

const toAccessTokenReply = (error: GoogleAuthError): AccessTokenReply => {
  if (error instanceof GoogleNotConnectedError) return { kind: 'not-connected', message: error.message };
  if (error instanceof GoogleReconnectRequiredError) return { kind: 'reconnect-required', message: error.message };
  return { kind: 'failed', message: error.message };
};

export const createTokenStoreRPC = (vault: TokenVault): TokenStoreRPC => ({
  status: () => vault.status().match((status) => status, never),
  startAuthorization: (start) => vault.startAuthorization(start).match(() => undefined, never),
  consumeAuthorization: (state) =>
    vault.consumeAuthorization(state).match(
      (codeVerifier): AuthorizationReply => ({ kind: 'ok', codeVerifier }),
      (error): AuthorizationReply => ({ kind: 'rejected', problem: error.problem }),
    ),
  saveConnection: (connection) => vault.saveConnection(connection).match(() => undefined, never),
  getAccessToken: () => vault.getAccessToken().match((accessToken): AccessTokenReply => ({ kind: 'ok', accessToken }), toAccessTokenReply),
  disconnect: () => vault.disconnect().match((disconnection) => disconnection, never),
});

// ---- Worker side ----

export interface TokenStore {
  status(): ResultAsync<ConnectionStatus, TokenStoreUnavailableError>;
  startAuthorization(start: AuthorizationStart): ResultAsync<void, TokenStoreUnavailableError>;
  consumeAuthorization(state: string): ResultAsync<string, OAuthStateError | TokenStoreUnavailableError>;
  saveConnection(connection: NewConnection): ResultAsync<void, TokenStoreUnavailableError>;
  // Fits core's GetAccessToken: every failure is a GoogleAuthError (subclassed for not-connected / reconnect).
  getAccessToken: GetAccessToken;
  disconnect(): ResultAsync<Disconnection, TokenStoreUnavailableError>;
}

const call = <T>(request: () => Promise<T>): ResultAsync<T, TokenStoreUnavailableError> =>
  ResultAsync.fromPromise(Promise.resolve().then(request), (cause) => new TokenStoreUnavailableError('The Google token store (Durable Object) could not be reached', { cause }));

const fromAuthorizationReply = (reply: AuthorizationReply): ResultAsync<string, OAuthStateError> => {
  switch (reply.kind) {
    case 'ok':
      return okAsync(reply.codeVerifier);
    case 'rejected':
      return errAsync(new OAuthStateError(reply.problem));
    default: {
      const _exhaustive: never = reply;
      throw new Error(`unhandled authorization reply: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const fromAccessTokenReply = (reply: AccessTokenReply): ResultAsync<string, GoogleAuthError> => {
  switch (reply.kind) {
    case 'ok':
      return okAsync(reply.accessToken);
    case 'not-connected':
      return errAsync(new GoogleNotConnectedError(reply.message));
    case 'reconnect-required':
      return errAsync(new GoogleReconnectRequiredError(reply.message));
    case 'failed':
      return errAsync(new GoogleAuthError(reply.message));
    default: {
      const _exhaustive: never = reply;
      throw new Error(`unhandled access token reply: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toAuthError = (error: TokenStoreUnavailableError): GoogleAuthError => new GoogleAuthError(`${error.message}. Retry the call.`, { cause: error });

export const createTokenStoreClient = (rpc: TokenStoreRPC): TokenStore => ({
  status: () => call(() => rpc.status()),
  startAuthorization: (start) => call(() => rpc.startAuthorization(start)),
  consumeAuthorization: (state) => call(() => rpc.consumeAuthorization(state)).andThen(fromAuthorizationReply),
  saveConnection: (connection) => call(() => rpc.saveConnection(connection)),
  getAccessToken: () =>
    call(() => rpc.getAccessToken())
      .mapErr(toAuthError)
      .andThen(fromAccessTokenReply),
  disconnect: () => call(() => rpc.disconnect()),
});
