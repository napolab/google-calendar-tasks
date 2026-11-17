import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CredentialStoreError } from '../../context/errors';

import { createCredentialStore, resolveCredentialDir } from './index';

const credentials = {
  refreshToken: 'refresh-1',
  scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks'],
  createdAt: '2026-11-17T04:00:00.000Z',
};

describe('resolveCredentialDir', () => {
  it('uses $XDG_CONFIG_HOME/gct when set', () => {
    expect(resolveCredentialDir({ XDG_CONFIG_HOME: '/xdg' }, '/home/me')).toBe('/xdg/gct');
  });

  it.each([
    ['unset', {}],
    ['empty', { XDG_CONFIG_HOME: '' }],
  ])('falls back to ~/.config/gct when XDG_CONFIG_HOME is %s', (_, env) => {
    expect(resolveCredentialDir(env, '/home/me')).toBe('/home/me/.config/gct');
  });
});

describe('createCredentialStore', () => {
  let base = '';
  let dir = '';

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'gct-store-'));
    dir = join(base, 'gct');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('stores credentials at <dir>/credentials.json', () => {
    expect(createCredentialStore({ dir }).path).toBe(join(dir, 'credentials.json'));
  });

  it('round-trips written credentials', async () => {
    const store = createCredentialStore({ dir });

    await store.write(credentials);
    const result = await store.read();

    expect(result._unsafeUnwrap()).toEqual({ kind: 'present', credentials });
  });

  it('creates the directory with mode 0700 and the file with mode 0600', async () => {
    const store = createCredentialStore({ dir });

    (await store.write(credentials))._unsafeUnwrap();

    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  });

  it('tightens the modes of a pre-existing directory and file', async () => {
    await mkdir(dir, { mode: 0o755 });
    await writeFile(join(dir, 'credentials.json'), '{}', { mode: 0o644 });
    const store = createCredentialStore({ dir });

    (await store.write(credentials))._unsafeUnwrap();

    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  });

  it('overwrites earlier credentials', async () => {
    const store = createCredentialStore({ dir });

    await store.write(credentials);
    await store.write({ ...credentials, refreshToken: 'refresh-2' });

    expect((await store.read())._unsafeUnwrap()).toEqual({ kind: 'present', credentials: { ...credentials, refreshToken: 'refresh-2' } });
  });

  it('reports missing credentials when nothing is stored', async () => {
    const result = await createCredentialStore({ dir }).read();

    expect(result._unsafeUnwrap()).toEqual({ kind: 'missing' });
  });

  it.each([
    ['is not JSON', 'not json'],
    ['has the wrong shape', '{"refreshToken":""}'],
  ])('fails with CredentialStoreError when the file %s', async (_, content) => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'credentials.json'), content);

    const error = (await createCredentialStore({ dir }).read())._unsafeUnwrapErr();

    expect(error).toBeInstanceOf(CredentialStoreError);
    expect(error.message).toContain(join(dir, 'credentials.json'));
  });

  it('never echoes the file content in a parse error', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'credentials.json'), '{"refreshToken":"leaky-token","scope":"x"}');

    const error = (await createCredentialStore({ dir }).read())._unsafeUnwrapErr();

    expect(error.message).not.toContain('leaky-token');
  });

  it('removes stored credentials', async () => {
    const store = createCredentialStore({ dir });
    await store.write(credentials);

    (await store.remove())._unsafeUnwrap();

    expect((await store.read())._unsafeUnwrap()).toEqual({ kind: 'missing' });
  });

  it('treats removing missing credentials as success', async () => {
    const result = await createCredentialStore({ dir }).remove();

    expect(result.isOk()).toBe(true);
  });

  it('writes pretty JSON without extra fields', async () => {
    const store = createCredentialStore({ dir });

    await store.write(credentials);

    expect(JSON.parse(await readFile(store.path, 'utf8'))).toEqual(credentials);
  });
});
