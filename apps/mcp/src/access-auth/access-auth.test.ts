import { Hono } from 'hono';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { InvalidAccessAssertion } from '../errors';
import { ACCESS_ASSERTION_HEADER, accessAuth, createJoseVerifier, readAccessConfig } from './index';

import type { AccessConfig, VerifyAccessToken } from './index';

const ENV = { CF_ACCESS_TEAM_DOMAIN: 'team', CF_ACCESS_AUD: 'aud-1' };

type Seen = { token: string; config: AccessConfig };

const appWith = (verify: VerifyAccessToken) =>
  new Hono<{ Bindings: typeof ENV; Variables: { identity: { email: string } } }>().use(accessAuth({ verify })).get('/whoami', (c) => c.json(c.var.identity));

const recordingVerify = (email: string) => {
  const seen: Seen[] = [];
  const verify: VerifyAccessToken = (token, config) => {
    seen.push({ token, config });
    return okAsync({ email });
  };
  return { verify, seen };
};

describe('readAccessConfig', () => {
  it('reads the team domain and the audience', () => {
    expect(readAccessConfig(ENV)._unsafeUnwrap()).toEqual({ teamDomain: 'team', aud: 'aud-1' });
  });

  it.each([
    { CF_ACCESS_TEAM_DOMAIN: '', CF_ACCESS_AUD: 'aud-1' },
    { CF_ACCESS_TEAM_DOMAIN: 'team', CF_ACCESS_AUD: '' },
    { CF_ACCESS_TEAM_DOMAIN: '  ', CF_ACCESS_AUD: ' ' },
  ])('treats an empty value as not configured (%o)', (env) => {
    expect(readAccessConfig(env).isErr()).toBe(true);
  });
});

describe('accessAuth', () => {
  it('verifies the assertion with the configured team and audience and exposes the identity', async () => {
    const { verify, seen } = recordingVerify('Owner@Example.com ');

    const response = await appWith(verify).request('/whoami', { headers: { [ACCESS_ASSERTION_HEADER]: 'jwt-1' } }, ENV);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'owner@example.com' });
    expect(seen).toEqual([{ token: 'jwt-1', config: { teamDomain: 'team', aud: 'aud-1' } }]);
  });

  it('answers 403 (never 401) without the assertion header', async () => {
    const { verify, seen } = recordingVerify('owner@example.com');

    const response = await appWith(verify).request('/whoami', {}, ENV);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
    expect(seen).toEqual([]);
  });

  it('answers 403 when the assertion does not verify', async () => {
    const verify: VerifyAccessToken = () => errAsync(new InvalidAccessAssertion('bad signature'));

    const response = await appWith(verify).request('/whoami', { headers: { [ACCESS_ASSERTION_HEADER]: 'jwt-1' } }, ENV);

    expect(response.status).toBe(403);
  });

  it('answers 403 when the verified identity has no email', async () => {
    const { verify } = recordingVerify('   ');

    const response = await appWith(verify).request('/whoami', { headers: { [ACCESS_ASSERTION_HEADER]: 'jwt-1' } }, ENV);

    expect(response.status).toBe(403);
  });

  it('fails closed with 500 when Access is not configured, without verifying anything', async () => {
    const { verify, seen } = recordingVerify('owner@example.com');

    const response = await appWith(verify).request('/whoami', { headers: { [ACCESS_ASSERTION_HEADER]: 'jwt-1' } }, { CF_ACCESS_TEAM_DOMAIN: '', CF_ACCESS_AUD: '' });

    expect(response.status).toBe(500);
    expect(seen).toEqual([]);
  });
});

describe('createJoseVerifier', () => {
  const CONFIG = { teamDomain: 'team', aud: 'aud-1' };

  const setup = async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const requested: string[] = [];
    const verify = createJoseVerifier({
      keysFor: (teamDomain) => {
        requested.push(teamDomain);
        return createLocalJWKSet({ keys: [jwk] });
      },
    });
    const sign = (claims: Record<string, unknown>, options: { issuer?: string; audience?: string } = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(options.issuer ?? 'https://team.cloudflareaccess.com')
        .setAudience(options.audience ?? 'aud-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
    return { verify, sign, requested };
  };

  it('returns the email of a valid assertion and reuses the team keys', async () => {
    const { verify, sign, requested } = await setup();
    const token = await sign({ email: 'owner@example.com' });

    expect((await verify(token, CONFIG))._unsafeUnwrap()).toEqual({ email: 'owner@example.com' });
    await verify(token, CONFIG);
    expect(requested).toEqual(['team']);
  });

  it.each([
    ['another audience', { audience: 'other-aud' }],
    ['another issuer', { issuer: 'https://evil.cloudflareaccess.com' }],
  ])('rejects %s', async (_label, options) => {
    const { verify, sign } = await setup();
    const token = await sign({ email: 'owner@example.com' }, options);

    expect((await verify(token, CONFIG))._unsafeUnwrapErr()).toBeInstanceOf(InvalidAccessAssertion);
  });

  it('rejects an assertion without an email claim', async () => {
    const { verify, sign } = await setup();
    const token = await sign({ sub: 'service-token' });

    expect((await verify(token, CONFIG))._unsafeUnwrapErr()).toBeInstanceOf(InvalidAccessAssertion);
  });

  it('rejects garbage', async () => {
    const { verify } = await setup();

    expect((await verify('not-a-jwt', CONFIG))._unsafeUnwrapErr()).toBeInstanceOf(InvalidAccessAssertion);
  });
});
