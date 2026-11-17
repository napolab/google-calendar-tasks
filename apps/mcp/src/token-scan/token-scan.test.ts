import { describe, expect, it } from 'vitest';

import { scanForTokens } from './index';

describe('scanForTokens', () => {
  it('finds nothing in plain identity data', () => {
    expect(scanForTokens({ email: 'a@example.com', idp: { id: 'x', type: 'oidc' }, groups: ['g'] })).toEqual([]);
  });

  it('reports a Google access token with its path and length but not its value', () => {
    const token = `ya29.${'a'.repeat(40)}`;
    expect(scanForTokens({ oidc_fields: { access_token: token } })).toEqual([{ path: '$.oidc_fields.access_token', kind: 'google-access-token', length: token.length }]);
  });

  it('reports a Google refresh token', () => {
    const token = `1//0g${'b'.repeat(30)}`;
    expect(scanForTokens({ tokens: [token] })).toEqual([{ path: '$.tokens[0]', kind: 'google-refresh-token', length: token.length }]);
  });

  it('reports a JWT-shaped value (e.g. an id_token)', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
    expect(scanForTokens({ custom: { id_token: jwt } })).toEqual([{ path: '$.custom.id_token', kind: 'jwt', length: jwt.length }]);
  });

  it('walks nested arrays and objects', () => {
    const token = `ya29.${'c'.repeat(10)}`;
    expect(scanForTokens([{ a: [{ b: token }] }])).toEqual([{ path: '$[0].a[0].b', kind: 'google-access-token', length: token.length }]);
  });
});
