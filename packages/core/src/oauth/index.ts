// Google OAuth 2.0 for installed (desktop) apps: authorization code + PKCE, refresh-token grant.
// Runtime-agnostic: fetch + Web Crypto only (https://developers.google.com/identity/protocols/oauth2/native-app).
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { z } from 'zod';

import { GoogleAuthError, GoogleNetworkError, GoogleResponseParseError } from '../errors';

import type { Fetch, GetAccessToken } from '../google-client';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// Epoch-milliseconds clock. Injected so callers (and tests) own time; core never reads the system clock.
export type Now = () => number;

export type PKCE = { readonly verifier: string; readonly challenge: string };

const toBase64URL = (bytes: Uint8Array): string => {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

// RFC 7636 §4.2: code_challenge = BASE64URL(SHA256(ASCII(code_verifier))).
export const toCodeChallenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64URL(new Uint8Array(digest));
};

// 32 random bytes → a 43-char verifier (RFC 7636 §4.1 allows 43..128 chars).
export const createPKCE = async (): Promise<PKCE> => {
  const verifier = toBase64URL(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await toCodeChallenge(verifier) };
};

// Which Google account the consent screen should preselect.
export type AccountSelection = { readonly kind: 'any' } | { readonly kind: 'hint'; readonly loginHint: string };

export type AuthorizationURLParams = {
  readonly clientId: string;
  readonly redirectURI: string;
  readonly scopes: readonly string[];
  readonly state: string;
  readonly codeChallenge: string;
  readonly account: AccountSelection;
};

type QueryEntry = readonly [string, string];

const accountQuery = (account: AccountSelection): readonly QueryEntry[] => {
  switch (account.kind) {
    case 'any':
      return [];
    case 'hint':
      return [['login_hint', account.loginHint]];
    default: {
      const _exhaustive: never = account;
      throw new Error(`unhandled account selection: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const buildAuthorizationURL = (params: AuthorizationURLParams): string => {
  const entries: QueryEntry[] = [
    ['client_id', params.clientId],
    ['redirect_uri', params.redirectURI],
    ['response_type', 'code'],
    ['scope', params.scopes.join(' ')],
    ['state', params.state],
    ['code_challenge', params.codeChallenge],
    ['code_challenge_method', 'S256'],
    // offline + consent: Google issues a refresh token on every login, not only the first one.
    ['access_type', 'offline'],
    ['prompt', 'consent'],
    ['include_granted_scopes', 'true'],
    ...accountQuery(params.account),
  ];
  return `${AUTHORIZATION_ENDPOINT}?${new URLSearchParams(entries.map(([key, value]) => [key, value])).toString()}`;
};

// A short-lived access token. `expiresAt` is epoch milliseconds.
export type AccessToken = {
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly scope: readonly string[];
};

// The result of a successful authorization-code exchange: always carries the long-lived refresh token.
export type TokenSet = AccessToken & { readonly refreshToken: string };

export type TokenEndpointError = GoogleAuthError | GoogleNetworkError | GoogleResponseParseError;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

type TokenResponse = z.output<typeof tokenResponseSchema>;

const oauthErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });

// A non-2xx answer either carries a standard OAuth error body (RFC 6749 §5.2) or something else (HTML, empty).
type ErrorDetail = { readonly kind: 'oauth'; readonly body: z.output<typeof oauthErrorSchema> } | { readonly kind: 'opaque' };

const toErrorDetail = (raw: unknown): ErrorDetail => {
  const parsed = oauthErrorSchema.safeParse(raw);
  return parsed.success ? { kind: 'oauth', body: parsed.data } : { kind: 'opaque' };
};

type TokenGrant =
  | { readonly grantType: 'authorization_code'; readonly code: string; readonly codeVerifier: string; readonly redirectURI: string }
  | { readonly grantType: 'refresh_token'; readonly refreshToken: string };

type ClientCredentials = { readonly clientId: string; readonly clientSecret: string };

const toGrantParams = (grant: TokenGrant): Readonly<Record<string, string>> => {
  switch (grant.grantType) {
    case 'authorization_code':
      return { grant_type: grant.grantType, code: grant.code, code_verifier: grant.codeVerifier, redirect_uri: grant.redirectURI };
    case 'refresh_token':
      return { grant_type: grant.grantType, refresh_token: grant.refreshToken };
    default: {
      const _exhaustive: never = grant;
      throw new Error(`unhandled grant: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toFormBody = (client: ClientCredentials, grant: TokenGrant): string =>
  new URLSearchParams({ ...toGrantParams(grant), client_id: client.clientId, client_secret: client.clientSecret }).toString();

const postForm = (fetch: Fetch, url: string, body: string): Promise<Response> =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });

const readJSON = (response: Response): Promise<unknown> => response.json();

const readJSONOrUndefined = (response: Response): Promise<unknown> => readJSON(response).catch(() => undefined);

// Only the parsed `error` / `error_description` fields reach the message — never the raw body or the request.
const describeOAuthError = (endpoint: string, status: number, detail: ErrorDetail): string => {
  const prefix = `Google ${endpoint} endpoint returned HTTP ${status}`;
  switch (detail.kind) {
    case 'oauth': {
      const description = detail.body.error_description === undefined ? '' : ` (${detail.body.error_description})`;
      return `${prefix}: ${detail.body.error}${description}`;
    }
    case 'opaque':
      return prefix;
    default: {
      const _exhaustive: never = detail;
      throw new Error(`unhandled error detail: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Extra advice appended to the message when Google answers with a specific OAuth error code.
type ErrorHint = { readonly kind: 'none' } | { readonly kind: 'on-code'; readonly code: string; readonly advice: string };

// The advice sentences that apply to this failure (zero or one).
const adviceFor = (hint: ErrorHint, detail: ErrorDetail): readonly string[] => {
  switch (hint.kind) {
    case 'none':
      return [];
    case 'on-code':
      return detail.kind === 'oauth' && detail.body.error === hint.code ? [hint.advice] : [];
    default: {
      const _exhaustive: never = hint;
      throw new Error(`unhandled error hint: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toEndpointError =
  (endpoint: string, hint: ErrorHint) =>
  (response: Response): ResultAsync<never, GoogleAuthError> =>
    ResultAsync.fromSafePromise(readJSONOrUndefined(response)).andThen((raw) => {
      const detail = toErrorDetail(raw);
      return errAsync(new GoogleAuthError([describeOAuthError(endpoint, response.status, detail), ...adviceFor(hint, detail)].join('. ')));
    });

const parseTokenResponse = (response: Response): ResultAsync<TokenResponse, GoogleResponseParseError> =>
  ResultAsync.fromPromise(readJSON(response), (cause) => new GoogleResponseParseError('Google token endpoint response is not JSON', { cause })).andThen((raw) => {
    const parsed = tokenResponseSchema.safeParse(raw);
    if (parsed.success) return okAsync(parsed.data);
    return errAsync(new GoogleResponseParseError(`Unexpected Google token endpoint response shape: ${parsed.error.message}`, { cause: parsed.error }));
  });

type TokenRequest = {
  readonly fetch: Fetch;
  readonly client: ClientCredentials;
  readonly grant: TokenGrant;
  readonly hint: ErrorHint;
};

const requestToken = (req: TokenRequest): ResultAsync<TokenResponse, TokenEndpointError> =>
  ResultAsync.fromPromise(postForm(req.fetch, TOKEN_ENDPOINT, toFormBody(req.client, req.grant)), (cause) => new GoogleNetworkError('Request to the Google token endpoint failed', { cause })).andThen(
    (response): ResultAsync<TokenResponse, TokenEndpointError> => (response.ok ? parseTokenResponse(response) : toEndpointError('token', req.hint)(response)),
  );

const splitScope = (scope: string | undefined): readonly string[] => (scope ?? '').split(' ').filter((s) => s !== '');

const toAccessToken =
  (now: Now) =>
  (body: TokenResponse): AccessToken => ({ accessToken: body.access_token, expiresAt: now() + body.expires_in * 1000, scope: splitScope(body.scope) });

export type ExchangeAuthorizationCodeParams = {
  readonly fetch: Fetch;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectURI: string;
  readonly now: Now;
};

const exchangeHint: ErrorHint = {
  kind: 'on-code',
  code: 'invalid_grant',
  advice: 'The authorization code expired or was already used, or the PKCE verifier did not match — run the login again.',
};

const requireRefreshToken =
  (now: Now) =>
  (body: TokenResponse): ResultAsync<TokenSet, GoogleAuthError> => {
    if (body.refresh_token === undefined)
      return errAsync(
        new GoogleAuthError(
          'Google returned no refresh token. The authorization URL must request access_type=offline with prompt=consent; revoke the app at https://myaccount.google.com/permissions and log in again.',
        ),
      );
    return okAsync({ ...toAccessToken(now)(body), refreshToken: body.refresh_token });
  };

export const exchangeAuthorizationCode = (params: ExchangeAuthorizationCodeParams): ResultAsync<TokenSet, TokenEndpointError> =>
  requestToken({
    fetch: params.fetch,
    client: params,
    grant: { grantType: 'authorization_code', code: params.code, codeVerifier: params.codeVerifier, redirectURI: params.redirectURI },
    hint: exchangeHint,
  }).andThen(requireRefreshToken(params.now));

export type RefreshAccessTokenParams = {
  readonly fetch: Fetch;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly now: Now;
};

const refreshHint: ErrorHint = { kind: 'on-code', code: 'invalid_grant', advice: 'The stored refresh token has expired or been revoked — log in again.' };

export const refreshAccessToken = (params: RefreshAccessTokenParams): ResultAsync<AccessToken, TokenEndpointError> =>
  requestToken({ fetch: params.fetch, client: params, grant: { grantType: 'refresh_token', refreshToken: params.refreshToken }, hint: refreshHint }).map(toAccessToken(params.now));

// Refresh a little early so a token never expires between being handed out and being used.
const EXPIRY_SKEW_MS = 60_000;

const isFresh = (token: AccessToken, now: number): boolean => now < token.expiresAt - EXPIRY_SKEW_MS;

// GetAccessToken only speaks GoogleAuthError; network / parse failures keep their class on `cause`.
const toAuthError = (error: TokenEndpointError): GoogleAuthError =>
  error instanceof GoogleAuthError ? error : new GoogleAuthError(`Could not refresh the Google access token: ${error.message}`, { cause: error });

// The provider's cache: nothing yet (or the last refresh failed), a token, or one refresh in flight.
type ProviderState = { readonly kind: 'empty' } | { readonly kind: 'cached'; readonly token: AccessToken } | { readonly kind: 'refreshing'; readonly request: ResultAsync<string, GoogleAuthError> };

// Caches the access token until ~60s before expiry and coalesces concurrent refreshes into one request.
// Failures are never cached: the next call retries.
export const createRefreshTokenProvider = (params: RefreshAccessTokenParams): GetAccessToken => {
  let state: ProviderState = { kind: 'empty' };

  const startRefresh = (): ResultAsync<string, GoogleAuthError> => {
    const request = refreshAccessToken(params)
      .mapErr(toAuthError)
      .andTee((token) => {
        state = { kind: 'cached', token };
      })
      .orTee(() => {
        state = { kind: 'empty' };
      })
      .map((token) => token.accessToken);
    state = { kind: 'refreshing', request };
    return request;
  };

  return () => {
    switch (state.kind) {
      case 'empty':
        return startRefresh();
      case 'refreshing':
        return state.request;
      case 'cached':
        return isFresh(state.token, params.now()) ? okAsync(state.token.accessToken) : startRefresh();
      default: {
        const _exhaustive: never = state;
        throw new Error(`unhandled provider state: ${JSON.stringify(_exhaustive)}`);
      }
    }
  };
};

export type RevokeTokenParams = { readonly fetch: Fetch; readonly token: string };

const noHint: ErrorHint = { kind: 'none' };

// Revokes an access or refresh token (revoking the refresh token also revokes its access tokens).
export const revokeToken = (params: RevokeTokenParams): ResultAsync<void, GoogleAuthError | GoogleNetworkError> =>
  ResultAsync.fromPromise(
    postForm(params.fetch, REVOKE_ENDPOINT, new URLSearchParams({ token: params.token }).toString()),
    (cause) => new GoogleNetworkError('Request to the Google revoke endpoint failed', { cause }),
  ).andThen((response): ResultAsync<void, GoogleAuthError> => (response.ok ? okAsync(undefined) : toEndpointError('revoke', noHint)(response)));
