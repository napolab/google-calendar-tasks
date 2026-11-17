import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { z } from 'zod';

import { CallbackPage } from '../callback-page';

import type { Context } from 'hono';

// The loopback server's HTTP surface: GET /callback for the OAuth redirect (http://127.0.0.1:<port>/callback?...),
// 404 for everything else. Runtime-free (no port): the loopback server mounts `app.fetch`, tests call `app.request`.

// Path of the loopback redirect URI (Desktop-app clients accept any path on a loopback redirect).
export const CALLBACK_PATH = '/callback';

// A redirect that decides the login in progress.
export type LoginCallback =
  // Google redirected back with an authorization code and the state we sent.
  | { readonly kind: 'code'; readonly code: string }
  // Google redirected back with an OAuth error (e.g. `access_denied` when the user declined).
  | { readonly kind: 'error'; readonly error: string }
  // A redirect that must not be trusted.
  | { readonly kind: 'invalid'; readonly reason: 'state-mismatch' | 'missing-code' };

// Everything the callback server can answer: a login callback, or a request that is not one
// (another path such as /favicon.ico, or no login waiting) — answered 404 while the login keeps waiting.
export type CallbackResult = LoginCallback | { readonly kind: 'ignored' };

export type CallbackAppDeps = {
  // The `state` sent in the authorization URL; redirects carrying anything else are reported as invalid.
  readonly expectedState: string;
  // Receives every redirect on the callback path (success, Google error, or invalid); the loopback server keeps the first.
  readonly onCallback: (callback: LoginCallback) => void;
};

// ---- the redirect's query ----

// What Google can send back. An error wins over a code; `state` is required on a code (it must match) and may be
// missing on an error (then it cannot match). Anything else — no code, an empty code, repeated parameters — fails
// validation and is handled as a malformed redirect.
const redirectSchema = z.union([
  z.object({ error: z.string(), state: z.string().optional() }).transform((query) => ({ kind: 'error' as const, error: query.error, state: query.state })),
  z.object({ code: z.string().min(1), state: z.string() }).transform((query) => ({ kind: 'code' as const, code: query.code, state: query.state })),
]);

type Redirect = z.output<typeof redirectSchema> | { readonly kind: 'malformed'; readonly state: string | undefined };

// The state is checked before anything else in the redirect is trusted.
const toLoginCallback = (redirect: Redirect, expectedState: string): LoginCallback => {
  if (redirect.state !== expectedState) return { kind: 'invalid', reason: 'state-mismatch' };
  switch (redirect.kind) {
    case 'code':
      return { kind: 'code', code: redirect.code };
    case 'error':
      return { kind: 'error', error: redirect.error };
    case 'malformed':
      return { kind: 'invalid', reason: 'missing-code' };
    default: {
      const _exhaustive: never = redirect;
      throw new Error(`unhandled redirect: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// ---- responses ----

type PageStatus = 200 | 400 | 404;

const statusOf = (result: CallbackResult): PageStatus => {
  switch (result.kind) {
    case 'code':
    case 'error':
      return 200;
    case 'invalid':
      return 400;
    case 'ignored':
      return 404;
    default: {
      const _exhaustive: never = result;
      throw new Error(`unhandled callback result: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// The page shows only what a variant carries (never the raw query).
const renderPage = (c: Context, result: CallbackResult): Response | Promise<Response> => {
  c.header('cache-control', 'no-store');
  return c.html(html`<!doctype html>${<CallbackPage result={result} />}`, statusOf(result));
};

// Hands the redirect to the login and answers the browser.
const settle = (deps: CallbackAppDeps, c: Context, redirect: Redirect): Response | Promise<Response> => {
  const callback = toLoginCallback(redirect, deps.expectedState);
  deps.onCallback(callback);
  return renderPage(c, callback);
};

// A redirect the schema rejects is still judged by its state first, then reported as missing a code.
const settleMalformed =
  (deps: CallbackAppDeps) =>
  (result: { readonly success: boolean }, c: Context): Response | Promise<Response> | undefined =>
    result.success ? undefined : settle(deps, c, { kind: 'malformed', state: c.req.query('state') });

// One method chain, so the route types survive into `CallbackAppType` (Hono RPC style).
export const createCallbackApp = (deps: CallbackAppDeps) =>
  new Hono().get(CALLBACK_PATH, zValidator('query', redirectSchema, settleMalformed(deps)), (c) => settle(deps, c, c.req.valid('query'))).notFound((c) => renderPage(c, { kind: 'ignored' }));

export type CallbackAppType = ReturnType<typeof createCallbackApp>;
