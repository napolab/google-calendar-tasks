import { Hono } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ResultAsync, errAsync } from 'neverthrow';

import { scanForTokens } from './token-scan';

import type { JWTPayload, JWTVerifyGetKey } from 'jose';

type HonoEnv = { Bindings: Env };

// Experiment: can the Google token obtained by Cloudflare Access (Generic OIDC IdP with
// calendar/tasks scopes) be reused by the Worker? Reports only key names and token-shaped
// findings (path / kind / length) — never token values.

const ACCESS_ASSERTION_HEADER = 'Cf-Access-Jwt-Assertion';

class AccessAssertionError extends Error {
  override name = 'AccessAssertionError' as const;
}

class IdentityFetchError extends Error {
  override name = 'IdentityFetchError' as const;
}

// jose caches keys inside the remote JWKS; keep one per team for the isolate's lifetime.
const jwksByTeam = new Map<string, JWTVerifyGetKey>();
const jwksFor = (team: string): JWTVerifyGetKey => {
  const cached = jwksByTeam.get(team);
  if (cached !== undefined) return cached;
  const keys = createRemoteJWKSet(new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`));
  jwksByTeam.set(team, keys);
  return keys;
};

const verifyAssertion = (token: string | undefined, env: Env): ResultAsync<JWTPayload, AccessAssertionError> => {
  if (token === undefined || token === '') return errAsync(new AccessAssertionError('Cf-Access-Jwt-Assertion header is missing'));
  const team: string = env.CF_ACCESS_TEAM_DOMAIN;
  const aud: string = env.CF_ACCESS_AUD;
  return ResultAsync.fromPromise(
    jwtVerify(token, jwksFor(team), { issuer: `https://${team}.cloudflareaccess.com`, audience: aud }),
    (cause) => new AccessAssertionError('Access JWT verification failed', { cause }),
  ).map(({ payload }) => payload);
};

const fetchIdentity = (requestURL: string, cookie: string | undefined): ResultAsync<{ status: number; body: unknown }, IdentityFetchError> =>
  ResultAsync.fromPromise(
    fetch(new URL('/cdn-cgi/access/get-identity', requestURL), { headers: { cookie: cookie ?? '' } }).then(async (response) => ({
      status: response.status,
      body: await response.json().catch((): unknown => null),
    })),
    (cause) => new IdentityFetchError('get-identity request failed', { cause }),
  );

const keysOf = (value: unknown): readonly string[] => (typeof value === 'object' && value !== null ? Object.keys(value) : []);

const pick = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined);

export const createApp = () =>
  new Hono<HonoEnv>()
    .get('/', (c) => c.text('gct-mcp (staging)'))
    .get('/debug/access-identity', (c) =>
      verifyAssertion(c.req.header(ACCESS_ASSERTION_HEADER), c.env)
        .andThen((jwt) => fetchIdentity(c.req.url, c.req.header('cookie')).map((identity) => ({ jwt, identity })))
        .match(
          ({ jwt, identity }) =>
            c.json({
              jwt: { keys: keysOf(jwt), email: jwt['email'] },
              identity: {
                status: identity.status,
                keys: keysOf(identity.body),
                idp: pick(identity.body, 'idp'),
                oidcFieldKeys: keysOf(pick(identity.body, 'oidc_fields')),
                customKeys: keysOf(pick(identity.body, 'custom')),
              },
              findings: scanForTokens({ jwt, identity: identity.body }),
            }),
          (error) => c.json({ error: { name: error.name, message: error.message } }, error instanceof AccessAssertionError ? 403 : 502),
        ),
    );

export type AppType = ReturnType<typeof createApp>;

export default createApp();
