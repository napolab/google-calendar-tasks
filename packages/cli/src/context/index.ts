import type { AuthorizationDeniedError, ConfigError, CredentialStoreError, InvalidCallbackError, LoginTimeoutError, LoopbackServerError, NotLoggedInError } from './errors';
import type { GoogleAuthError, GoogleNetworkError } from '@napolab/gct-core/errors';
import type { GetAccessToken } from '@napolab/gct-core/google-client';
import type { Now, TokenEndpointError } from '@napolab/gct-core/oauth';
import type { Services } from '@napolab/gct-core/services';
import type { ResultAsync } from 'neverthrow';

// The contract between the layers (interfaces and data types only):
//
//   main.ts ──creates──▶ services/** (Node implementations) ──implement──▶ context
//   main.ts ──wires core's Google services inline (no aggregator factories)
//   main.ts ──injects CliContext──▶ commands/** ──depend on──▶ context + @napolab/gct-core
//
// commands/** never import services/**, and services/** never import commands/** (enforced by
// .oxlintrc.json and src/layers.test.ts). Commands are tested with fake CliContext members.

// ---- output ----

// The process's output channels. main.ts binds them to stdout / stderr / process.exitCode; tests capture them.
export type Output = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  // Marks the run as failed (exit code 1) without stopping it.
  readonly fail: () => void;
};

// ---- auth ----

// What `gct status` may show — never the refresh token.
export type AuthStatus =
  | { readonly kind: 'logged-out'; readonly credentialPath: string }
  | { readonly kind: 'logged-in'; readonly credentialPath: string; readonly scopes: readonly string[]; readonly loggedInAt: string };

// What a finished login may show — never the refresh token.
export type LoginSummary = { readonly credentialPath: string; readonly scopes: readonly string[]; readonly loggedInAt: string };

export type StartLoginError = ConfigError | LoopbackServerError;

export type LoginError = LoginTimeoutError | AuthorizationDeniedError | InvalidCallbackError | TokenEndpointError | CredentialStoreError;

export type LoginOptions = {
  // Deadline / cancellation owned by the login command (e.g. `AbortSignal.timeout(...)`); it bounds the wait for
  // the browser's redirect.
  readonly signal: AbortSignal;
  // Progress for the user (the consent URL); never receives a secret.
  readonly print: (line: string) => void;
};

// One login attempt holding the OAuth loopback server, already waiting for Google's redirect. The login command
// owns its lifetime (`await using`); disposing it closes the server.
export interface LoginSession extends AsyncDisposable {
  // Opens the consent page, waits for the redirect, exchanges the code and stores the refresh token.
  complete(): ResultAsync<LoginSummary, LoginError>;
}

export type Revocation = { readonly kind: 'revoked' } | { readonly kind: 'revoke-failed'; readonly error: GoogleAuthError | GoogleNetworkError };

export type LogoutOutcome = { readonly kind: 'not-logged-in' } | { readonly kind: 'logged-out'; readonly revocation: Revocation };

export type AccessTokenError = ConfigError | CredentialStoreError | NotLoggedInError;

export interface IAuthService {
  // Where the refresh token is stored (shown to the user; the path is not a secret).
  readonly credentialPath: string;
  // Prepares state + PKCE and starts the loopback server expecting that state, under `options.signal`.
  startLogin(options: LoginOptions): ResultAsync<LoginSession, StartLoginError>;
  // Revokes the stored refresh token at Google (best-effort) and deletes it locally either way.
  logout(): ResultAsync<LogoutOutcome, CredentialStoreError>;
  status(): ResultAsync<AuthStatus, CredentialStoreError>;
  // Token provider for core's Google client; fails up front when nobody is logged in.
  getAccessToken(): ResultAsync<GetAccessToken, AccessTokenError>;
}

// ---- Google services ----

export type ServicesError = AccessTokenError;

// ---- the context injected into every command ----

export type CliContext = {
  readonly output: Output;
  readonly clock: Now;
  readonly auth: IAuthService;
  // Core `Services` for one command run, built by the entrypoint on the stored login. Commands call it only after
  // their input is valid, so input errors win over "not logged in".
  readonly services: () => ResultAsync<Services, ServicesError>;
};
