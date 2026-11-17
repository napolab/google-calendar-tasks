import { randomBytes } from 'node:crypto';

import { dayjs } from '@napolab/gct-core/dayjs';
import { buildAuthorizationURL, createPKCE, createRefreshTokenProvider, exchangeAuthorizationCode, revokeToken } from '@napolab/gct-core/oauth';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';

import { AuthorizationDeniedError, InvalidCallbackError, NotLoggedInError } from '../../context/errors';

import type { Config } from '../config';
import type { Result } from 'neverthrow';
import type { CredentialStoreError } from '../../context/errors';
import type { CredentialState, CredentialStore, StoredCredentials } from '../credential-store';
import type { LoginCallback } from './callback-app';
import type { LoopbackServer, LoopbackServerOptions, OwnedLoopbackServer } from './loopback-server';
import type { BrowserOpenError } from './open-browser';
import type { Opened } from './open-browser/opener';
import type { Fetch, GetAccessToken } from '@napolab/gct-core/google-client';
import type { AccessTokenError, AuthStatus, IAuthService, LoginError, LoginOptions, LoginSession, LoginSummary, LogoutOutcome, Revocation, StartLoginError } from '../../context';
import type { ConfigError, LoopbackServerError } from '../../context/errors';
import type { Now, PKCE, TokenEndpointError, TokenSet } from '@napolab/gct-core/oauth';

// The CLI's Google auth use cases. Every long-lived resource (loopback server, AbortSignal, fetch, credential
// store, clock) is created and disposed by the entrypoint and passed in (.claude/rules/entrypoint-lifetime.md).

// Best-effort browser opener: a failure is non-fatal because the URL is printed as well.
export type OpenBrowser = (url: string) => ResultAsync<Opened, BrowserOpenError>;

// Unguessable OAuth `state` (CSRF protection for the loopback redirect).
export const createLoginState = (): string => randomBytes(32).toString('base64url');

export type LoginDeps = {
  // Already listening and expecting `state` (started by the entrypoint before the browser opens).
  readonly loopback: LoopbackServer;
  readonly state: string;
  readonly pkce: PKCE;
  readonly config: Config;
  readonly fetch: Fetch;
  readonly store: CredentialStore;
  readonly now: Now;
  readonly scopes: readonly string[];
  readonly openBrowser: OpenBrowser;
  readonly print: (line: string) => void;
};

export type LogoutDeps = { readonly fetch: Fetch; readonly store: CredentialStore };

export type GetAccessTokenDeps = { readonly config: Config; readonly store: CredentialStore; readonly fetch: Fetch; readonly now: Now };

export type GetAccessTokenError = CredentialStoreError | NotLoggedInError;

const promptConsent = (deps: LoginDeps): void => {
  const url = buildAuthorizationURL({
    clientId: deps.config.clientId,
    redirectURI: deps.loopback.redirectURI,
    scopes: deps.scopes,
    state: deps.state,
    codeChallenge: deps.pkce.challenge,
    account: { kind: 'any' },
  });
  deps.print('Open this URL in your browser to log in to Google (opening it automatically if possible):');
  deps.print(url);
  // Not awaited: the browser opener must not hold up waiting for the redirect. Failing to open is not fatal —
  // the URL is already on screen — so the failure is folded into a hint here.
  void deps.openBrowser(url).match(
    () => undefined,
    () => deps.print('Could not open a browser automatically; open the URL above manually.'),
  );
};

const requireCode = (callback: LoginCallback): ResultAsync<string, AuthorizationDeniedError | InvalidCallbackError> => {
  switch (callback.kind) {
    case 'code':
      return okAsync(callback.code);
    case 'error':
      return errAsync(new AuthorizationDeniedError(callback.error));
    case 'invalid':
      return errAsync(new InvalidCallbackError(`Rejected the login redirect (${callback.reason}). Run the login again.`));
    default: {
      const _exhaustive: never = callback;
      throw new Error(`unhandled login callback: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const exchange = (deps: LoginDeps, code: string): ResultAsync<TokenSet, TokenEndpointError> =>
  exchangeAuthorizationCode({
    fetch: deps.fetch,
    clientId: deps.config.clientId,
    clientSecret: deps.config.clientSecret,
    code,
    codeVerifier: deps.pkce.verifier,
    redirectURI: deps.loopback.redirectURI,
    now: deps.now,
  });

const save = (deps: LoginDeps, tokens: TokenSet): ResultAsync<StoredCredentials, CredentialStoreError> => {
  const credentials: StoredCredentials = { refreshToken: tokens.refreshToken, scope: tokens.scope, createdAt: dayjs(deps.now()).toISOString() };
  return deps.store.write(credentials).map(() => credentials);
};

// Loopback + PKCE login: send the user to Google, take the code from the loopback redirect, exchange it and
// persist the refresh token. Resolves with what was saved (it contains the refresh token — never print it).
// The loopback is already waiting for the redirect, so opening the browser first cannot lose it.
export const login = (deps: LoginDeps): ResultAsync<StoredCredentials, LoginError> => {
  promptConsent(deps);
  return deps.loopback.callback
    .andThen(requireCode)
    .andThen((code) => exchange(deps, code))
    .andThen((tokens) => save(deps, tokens));
};

const revoke = (deps: LogoutDeps, refreshToken: string): ResultAsync<Revocation, never> =>
  revokeToken({ fetch: deps.fetch, token: refreshToken })
    .map((): Revocation => ({ kind: 'revoked' }))
    .orElse((error) => okAsync<Revocation, never>({ kind: 'revoke-failed', error }));

const logoutFrom = (deps: LogoutDeps, state: CredentialState): ResultAsync<LogoutOutcome, CredentialStoreError> => {
  switch (state.kind) {
    case 'missing':
      return okAsync({ kind: 'not-logged-in' });
    case 'present':
      return revoke(deps, state.credentials.refreshToken).andThen((revocation) => deps.store.remove().map((): LogoutOutcome => ({ kind: 'logged-out', revocation })));
    default: {
      const _exhaustive: never = state;
      throw new Error(`unhandled credential state: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Revokes the stored refresh token at Google (best-effort) and deletes it locally either way.
export const logout = (deps: LogoutDeps): ResultAsync<LogoutOutcome, CredentialStoreError> => deps.store.read().andThen((state) => logoutFrom(deps, state));

const requireCredentials = (state: CredentialState): ResultAsync<StoredCredentials, NotLoggedInError> => {
  switch (state.kind) {
    case 'missing':
      return errAsync(new NotLoggedInError('Not logged in to Google yet. Run the login command first.'));
    case 'present':
      return okAsync(state.credentials);
    default: {
      const _exhaustive: never = state;
      throw new Error(`unhandled credential state: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Token provider for `createGoogleClient({ fetch, getAccessToken })`, built from the configured client and the
// stored refresh token. Fails up front when nobody is logged in.
export const createGetAccessToken = (deps: GetAccessTokenDeps): ResultAsync<GetAccessToken, GetAccessTokenError> =>
  deps.store
    .read()
    .andThen(requireCredentials)
    .map((credentials) =>
      createRefreshTokenProvider({ fetch: deps.fetch, clientId: deps.config.clientId, clientSecret: deps.config.clientSecret, refreshToken: credentials.refreshToken, now: deps.now }),
    );

// ---- IAuthService (the CliContext view of the use cases above) ----

export type AuthServiceDeps = {
  readonly config: Result<Config, ConfigError>;
  readonly store: CredentialStore;
  readonly fetch: Fetch;
  readonly now: Now;
  readonly scopes: readonly string[];
  readonly createState: () => string;
  readonly openBrowser: OpenBrowser;
  // Starts the loopback server for one login; the LoginSession built on it is disposed by the login command.
  readonly startLoopback: (options: LoopbackServerOptions) => ResultAsync<OwnedLoopbackServer, LoopbackServerError>;
};

const toAuthStatus = (state: CredentialState, credentialPath: string): AuthStatus => {
  switch (state.kind) {
    case 'missing':
      return { kind: 'logged-out', credentialPath };
    case 'present':
      return { kind: 'logged-in', credentialPath, scopes: state.credentials.scope, loggedInAt: state.credentials.createdAt };
    default: {
      const _exhaustive: never = state;
      throw new Error(`unhandled credential state: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Drops the refresh token: only what the user may see leaves the service.
const toLoginSummary = (credentialPath: string, credentials: StoredCredentials): LoginSummary => ({ credentialPath, scopes: credentials.scope, loggedInAt: credentials.createdAt });

type PreparedLogin = { readonly config: Config; readonly state: string; readonly pkce: PKCE; readonly loopback: OwnedLoopbackServer; readonly print: (line: string) => void };

const toLoginSession = (deps: AuthServiceDeps, prepared: PreparedLogin): LoginSession => ({
  complete: () =>
    login({ ...prepared, fetch: deps.fetch, store: deps.store, now: deps.now, scopes: deps.scopes, openBrowser: deps.openBrowser }).map((credentials) => toLoginSummary(deps.store.path, credentials)),
  [Symbol.asyncDispose]: () => prepared.loopback[Symbol.asyncDispose](),
});

// state + PKCE first, then the loopback server expecting that state — waiting for the redirect from the start.
const startLogin = (deps: AuthServiceDeps, options: LoginOptions): ResultAsync<LoginSession, StartLoginError> =>
  deps.config.asyncAndThen((config) =>
    ResultAsync.fromSafePromise(createPKCE()).andThen((pkce) => {
      const state = deps.createState();
      return deps.startLoopback({ expectedState: state, signal: options.signal }).map((loopback) => toLoginSession(deps, { config, state, pkce, loopback, print: options.print }));
    }),
  );

export const createAuthService = (deps: AuthServiceDeps): IAuthService => ({
  credentialPath: deps.store.path,
  startLogin: (options) => startLogin(deps, options),
  logout: () => logout({ fetch: deps.fetch, store: deps.store }),
  status: () => deps.store.read().map((state) => toAuthStatus(state, deps.store.path)),
  getAccessToken: (): ResultAsync<GetAccessToken, AccessTokenError> => deps.config.asyncAndThen((config) => createGetAccessToken({ config, store: deps.store, fetch: deps.fetch, now: deps.now })),
});
