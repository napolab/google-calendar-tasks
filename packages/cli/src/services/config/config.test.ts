import { describe, expect, it } from 'vitest';

import { ConfigError } from '../../context/errors';

import { loadConfig } from './index';

describe('loadConfig', () => {
  it('reads the OAuth client from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET', () => {
    const result = loadConfig({ GOOGLE_CLIENT_ID: 'id-1.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret-1' });

    expect(result._unsafeUnwrap()).toEqual({ clientId: 'id-1.apps.googleusercontent.com', clientSecret: 'secret-1' });
  });

  it.each([
    ['both missing', {}],
    ['secret missing', { GOOGLE_CLIENT_ID: 'id-1' }],
    ['id empty', { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: 'secret-1' }],
  ])('fails with ConfigError pointing at .env.example when %s', (_, env) => {
    const error = loadConfig(env)._unsafeUnwrapErr();

    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toContain('.env.example');
    expect(error.message).toContain('.env');
  });

  it('names the missing variable but never echoes a value', () => {
    const error = loadConfig({ GOOGLE_CLIENT_ID: 'id-1', GOOGLE_CLIENT_SECRET: '' })._unsafeUnwrapErr();

    expect(error.message).toContain('GOOGLE_CLIENT_SECRET');
    expect(error.message).not.toContain('id-1');
  });
});
