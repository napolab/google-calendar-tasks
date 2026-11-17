import { zValidator } from '@hono/zod-validator';
import { buildAuthorizationURL, createPKCE, exchangeAuthorizationCode, revokeToken } from '@napolab/gct-core/oauth';
import { ALL_SCOPES } from '@napolab/gct-core/scopes';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import { z } from 'zod';

import { MissingScopesError, OAuthStateError, TokenStoreUnavailableError } from '../../errors';
import { requireScopes } from '../../google-scopes';
import { ConnectResultPage, statusOf } from '../../pages/connect-result-page';
import { renderPage } from '../render-page';

import type { AppBindings, HonoEnv } from '../../hono-env';
import type { ConnectResult } from '../../pages/connect-result-page';
import type { TokenStore } from '../../token-store/rpc';
import type { Fetch } from '@napolab/gct-core/google-client';
import type { Now, TokenEndpointError, TokenSet } from '@napolab/gct-core/oauth';
import type { Context } from 'hono';

// /google/*: connect this Access user's Google account (authorization code + PKCE, state kept in the user's DO for
// 10 minutes, single use), and disconnect it.

export type GoogleRoutesDeps = { readonly fetch: Fetch; readonly now: Now };

// What Google sends back. An error wins over a code; anything else is a malformed callback.
const callbackQuerySchema = z.union([
  z.object({ error: z.string().min(1), state: z.string().optional() }).transform((query) => ({ kind: 'error' as const, error: query.error, state: query.state })),
  z.object({ code: z.string().min(1), state: z.string().min(1) }).transform((query) => ({ kind: 'code' as const, code: query.code, state: query.state })),
]);

const renderResult = (c: Context, result: ConnectResult): Response | Promise<Response> => renderPage(c, <ConnectResultPage result={result} />, statusOf(result));

// 32 random bytes as hex: unguessable, URL-safe.
const randomState = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');

type CallbackError = OAuthStateError | TokenStoreUnavailableError | TokenEndpointError | MissingScopesError;

// A partial grant is useless to the server: revoke it (best effort) and report what is missing.
const keepCompleteGrant =
  (fetch: Fetch) =>
  (tokens: TokenSet): ResultAsync<TokenSet, MissingScopesError> =>
    requireScopes(tokens.scope)
      .asyncAndThen(() => okAsync(tokens))
      .orElse((error) =>
        revokeToken({ fetch, token: tokens.refreshToken })
          .orElse(() => okAsync(undefined))
          .andThen(() => errAsync(error)),
      );

const completeConnection = (deps: GoogleRoutesDeps, env: AppBindings, tokenStore: TokenStore, code: string, state: string): ResultAsync<ConnectResult, CallbackError> =>
  tokenStore
    .consumeAuthorization(state)
    .andThen((codeVerifier) =>
      exchangeAuthorizationCode({ fetch: deps.fetch, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, code, codeVerifier, redirectURI: env.GOOGLE_REDIRECT_URI, now: deps.now }),
    )
    .andThen(keepCompleteGrant(deps.fetch))
    .andThen((tokens) =>
      tokenStore
        .saveConnection({ refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, scopes: tokens.scope })
        .map((): ConnectResult => ({ kind: 'connected', scopes: tokens.scope })),
    );

const toFailedResult = (error: CallbackError): ConnectResult => {
  console.warn('[google] connection failed', { error: error.name });
  if (error instanceof OAuthStateError) return { kind: 'state-rejected', problem: error.problem };
  if (error instanceof MissingScopesError) return { kind: 'missing-scopes', missing: error.missing };
  if (error instanceof TokenStoreUnavailableError) return { kind: 'store-unavailable' };
  return { kind: 'exchange-failed' };
};

// Google redirected with an error: drop the pending state (whatever it was) and show a fixed message.
const settleGoogleError = (tokenStore: TokenStore, error: string, state: string | undefined): ResultAsync<ConnectResult, never> => {
  const result: ConnectResult = error === 'access_denied' ? { kind: 'declined' } : { kind: 'google-error' };
  if (state === undefined) return okAsync(result);
  return tokenStore
    .consumeAuthorization(state)
    .map(() => result)
    .orElse(() => okAsync(result));
};

const renderMalformed = (result: { readonly success: boolean }, c: Context): Response | Promise<Response> | undefined => (result.success ? undefined : renderResult(c, { kind: 'malformed' }));

export const createGoogleRoutes = (deps: GoogleRoutesDeps) =>
  new Hono<HonoEnv>()
    .get('/connect', (c) => {
      const state = randomState();
      return ResultAsync.fromSafePromise(createPKCE())
        .andThen((pkce) => c.var.tokenStore.startAuthorization({ state, codeVerifier: pkce.verifier }).map(() => pkce))
        .match(
          (pkce) =>
            c.redirect(
              buildAuthorizationURL({
                clientId: c.env.GOOGLE_CLIENT_ID,
                redirectURI: c.env.GOOGLE_REDIRECT_URI,
                scopes: ALL_SCOPES,
                state,
                codeChallenge: pkce.challenge,
                account: { kind: 'hint', loginHint: c.var.identity.email },
              }),
              302,
            ),
          () => renderResult(c, { kind: 'store-unavailable' }),
        );
    })
    .get('/callback', zValidator('query', callbackQuerySchema, renderMalformed), (c) => {
      const query = c.req.valid('query');
      switch (query.kind) {
        case 'error':
          return settleGoogleError(c.var.tokenStore, query.error, query.state).match(
            (result) => renderResult(c, result),
            (result: never) => result,
          );
        case 'code':
          return completeConnection(deps, c.env, c.var.tokenStore, query.code, query.state).match(
            (result) => renderResult(c, result),
            (error) => renderResult(c, toFailedResult(error)),
          );
        default: {
          const _exhaustive: never = query;
          throw new Error(`unhandled callback: ${JSON.stringify(_exhaustive)}`);
        }
      }
    })
    .post('/disconnect', csrf(), (c) =>
      c.var.tokenStore.disconnect().match(
        (disconnection) => {
          if (disconnection.kind === 'revoke-failed') console.warn('[google] revocation failed; the connection was removed locally');
          return c.redirect('/', 303);
        },
        () => renderResult(c, { kind: 'store-unavailable' }),
      ),
    );

export type GoogleRoutesType = ReturnType<typeof createGoogleRoutes>;
