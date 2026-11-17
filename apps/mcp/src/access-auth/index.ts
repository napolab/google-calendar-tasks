import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ResultAsync, err, errAsync, ok, okAsync } from 'neverthrow';

import { AccessNotConfiguredError, InvalidAccessAssertion, MissingAccessAssertion } from '../errors';

import type { AccessAuthError } from '../errors';
import type { MiddlewareHandler } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import type { Result } from 'neverthrow';

// Cloudflare Access puts the signed JWT of the authenticated user on every request it forwards.
export const ACCESS_ASSERTION_HEADER = 'Cf-Access-Jwt-Assertion';

export type AccessEnv = { readonly CF_ACCESS_TEAM_DOMAIN: string; readonly CF_ACCESS_AUD: string };

export type AccessConfig = { readonly teamDomain: string; readonly aud: string };

// The verified user. `email` is normalized (trimmed, lower-cased) and non-empty.
export type AccessIdentity = { readonly email: string };

// Verifies an assertion against the team's keys. Returns the raw email claim (normalized by the middleware).
export type VerifyAccessToken = (token: string, config: AccessConfig) => ResultAsync<AccessIdentity, InvalidAccessAssertion>;

const nonEmpty = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim());

export const readAccessConfig = (env: AccessEnv): Result<AccessConfig, AccessNotConfiguredError> => {
  const teamDomain = nonEmpty(env.CF_ACCESS_TEAM_DOMAIN);
  const aud = nonEmpty(env.CF_ACCESS_AUD);
  if (teamDomain === undefined || aud === undefined) return err(new AccessNotConfiguredError('CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set'));
  return ok({ teamDomain, aud });
};

const issuerOf = (teamDomain: string): string => `https://${teamDomain}.cloudflareaccess.com`;

export const remoteAccessKeys = (teamDomain: string): JWTVerifyGetKey => createRemoteJWKSet(new URL(`${issuerOf(teamDomain)}/cdn-cgi/access/certs`));

export type JoseVerifierDeps = {
  // The team's signing keys. jose caches keys inside a remote JWKS, so the verifier keeps one per team.
  readonly keysFor: (teamDomain: string) => JWTVerifyGetKey;
};

const emailClaim = (payload: Readonly<Record<string, unknown>>): ResultAsync<AccessIdentity, InvalidAccessAssertion> => {
  const email = payload['email'];
  return typeof email === 'string' ? okAsync({ email }) : errAsync(new InvalidAccessAssertion('The Access assertion carries no email claim'));
};

// Created once at the entrypoint: owns the per-team JWKS cache for the isolate's lifetime.
export const createJoseVerifier = (deps: JoseVerifierDeps): VerifyAccessToken => {
  const keysByTeam = new Map<string, JWTVerifyGetKey>();
  const keysFor = (teamDomain: string): JWTVerifyGetKey => {
    const cached = keysByTeam.get(teamDomain);
    if (cached !== undefined) return cached;
    const keys = deps.keysFor(teamDomain);
    keysByTeam.set(teamDomain, keys);
    return keys;
  };

  return (token, config) =>
    ResultAsync.fromPromise(
      jwtVerify(token, keysFor(config.teamDomain), { issuer: issuerOf(config.teamDomain), audience: config.aud }),
      (cause) => new InvalidAccessAssertion('Access JWT verification failed', { cause }),
    ).andThen(({ payload }) => emailClaim(payload));
};

const readAssertion = (header: string | undefined): Result<string, MissingAccessAssertion> =>
  header === undefined || header === '' ? err(new MissingAccessAssertion('Cf-Access-Jwt-Assertion header is missing')) : ok(header);

const normalizeEmail = (identity: AccessIdentity): Result<AccessIdentity, InvalidAccessAssertion> => {
  const email = identity.email.trim().toLowerCase();
  return email === '' ? err(new InvalidAccessAssertion('The Access assertion carries an empty email')) : ok({ email });
};

// Authentication failures answer 403, never 401: a 401 would send MCP clients into an OAuth flow that cannot succeed
// (Access, not this Worker, is the authorization server). Missing configuration answers 500 (fail closed).
type AccessAuthEnv = { Bindings: AccessEnv; Variables: { identity: AccessIdentity } };

export type AccessAuthDeps = { readonly verify: VerifyAccessToken };

const authenticate = (env: AccessEnv, header: string | undefined, verify: VerifyAccessToken): ResultAsync<AccessIdentity, AccessNotConfiguredError | AccessAuthError> =>
  readAccessConfig(env)
    .andThen((config) => readAssertion(header).map((token) => ({ config, token })))
    .asyncAndThen(({ config, token }) => verify(token, config))
    .andThen(normalizeEmail);

const logRejection = (error: AccessNotConfiguredError | AccessAuthError): void => {
  if (error instanceof AccessNotConfiguredError) {
    console.error('[access] Cloudflare Access is not configured', { error: error.name });
    return;
  }
  console.warn('[access] authentication failed', { error: error.name });
};

// Authentication failures answer 403, never 401: a 401 would send MCP clients into an OAuth flow that cannot succeed
// (Access, not this Worker, is the authorization server). Missing configuration answers 500 (fail closed).
export const accessAuth =
  (deps: AccessAuthDeps): MiddlewareHandler<AccessAuthEnv> =>
  async (c, next) =>
    authenticate(c.env, c.req.header(ACCESS_ASSERTION_HEADER), deps.verify).match(
      async (identity) => {
        c.set('identity', identity);
        await next();
        return undefined;
      },
      (error) => {
        logRejection(error);
        return error instanceof AccessNotConfiguredError ? c.json({ error: 'internal_error' }, 500) : c.json({ error: 'forbidden' }, 403);
      },
    );
