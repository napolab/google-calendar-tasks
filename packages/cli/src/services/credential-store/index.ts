import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Result, ResultAsync, errAsync, okAsync } from 'neverthrow';
import { z } from 'zod';

import { CredentialStoreError } from '../../context/errors';

// What `login` persists. Only the long-lived refresh token is stored; access tokens live in memory.
export type StoredCredentials = {
  readonly refreshToken: string;
  readonly scope: readonly string[];
  readonly createdAt: string; // ISO 8601
};

// Reading the store: either nothing was saved yet (never logged in / logged out) or the saved credentials.
export type CredentialState = { readonly kind: 'missing' } | { readonly kind: 'present'; readonly credentials: StoredCredentials };

export interface CredentialStore {
  readonly path: string;
  read(): ResultAsync<CredentialState, CredentialStoreError>;
  write(credentials: StoredCredentials): ResultAsync<void, CredentialStoreError>;
  remove(): ResultAsync<void, CredentialStoreError>;
}

export type CredentialStoreOptions = { readonly dir: string };

// `process.env` shape: the variable is genuinely absent or set (possibly to '').
export type XDGEnv = { readonly XDG_CONFIG_HOME?: string | undefined };

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const credentialsSchema = z.object({
  refreshToken: z.string().min(1),
  scope: z.array(z.string()),
  createdAt: z.string(),
});

// $XDG_CONFIG_HOME/gct, falling back to ~/.config/gct (XDG Base Directory spec: empty counts as unset).
export const resolveCredentialDir = (env: XDGEnv, homeDir: string): string => {
  const base = env.XDG_CONFIG_HOME === undefined || env.XDG_CONFIG_HOME === '' ? join(homeDir, '.config') : env.XDG_CONFIG_HOME;
  return join(base, 'gct');
};

const isNotFound = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

const parseJSON = Result.fromThrowable(
  (text: string): unknown => JSON.parse(text),
  () => undefined,
);

// Parse failures never quote the content: it holds the refresh token.
const parseCredentials =
  (path: string) =>
  (text: string): ResultAsync<CredentialState, CredentialStoreError> => {
    const parsed = credentialsSchema.safeParse(parseJSON(text).unwrapOr(undefined));
    if (parsed.success) return okAsync({ kind: 'present', credentials: parsed.data });
    return errAsync(new CredentialStoreError(`${path} is corrupt. Log in again to recreate it.`));
  };

const readText = (path: string): ResultAsync<{ readonly kind: 'missing' } | { readonly kind: 'text'; readonly text: string }, CredentialStoreError> =>
  ResultAsync.fromPromise(readFile(path, 'utf8'), (cause) => cause)
    .map((text) => ({ kind: 'text' as const, text }))
    .orElse((cause) => (isNotFound(cause) ? okAsync({ kind: 'missing' as const }) : errAsync(new CredentialStoreError(`Could not read ${path}`, { cause }))));

const readCredentials = (path: string): ResultAsync<CredentialState, CredentialStoreError> =>
  readText(path).andThen((file) => {
    switch (file.kind) {
      case 'missing':
        return okAsync(file);
      case 'text':
        return parseCredentials(path)(file.text);
      default: {
        const _exhaustive: never = file;
        throw new Error(`unhandled file state: ${JSON.stringify(_exhaustive)}`);
      }
    }
  });

const serialize = (credentials: StoredCredentials): string => `${JSON.stringify({ refreshToken: credentials.refreshToken, scope: credentials.scope, createdAt: credentials.createdAt }, null, 2)}\n`;

// mkdir / writeFile modes are masked by umask and ignored for existing paths, so chmod explicitly.
// Write to a temp file and rename so a crash never leaves a half-written credentials file.
const writeAtomically = async (dir: string, path: string, body: string): Promise<void> => {
  const tmp = `${path}.tmp`;
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  await chmod(dir, DIR_MODE);
  await writeFile(tmp, body, { mode: FILE_MODE });
  await chmod(tmp, FILE_MODE);
  await rename(tmp, path);
};

const writeCredentials = (dir: string, path: string, credentials: StoredCredentials): ResultAsync<void, CredentialStoreError> =>
  ResultAsync.fromPromise(writeAtomically(dir, path, serialize(credentials)), (cause) => new CredentialStoreError(`Could not write ${path}`, { cause }));

// Idempotent: removing credentials that do not exist succeeds.
const removeCredentials = (path: string): ResultAsync<void, CredentialStoreError> =>
  ResultAsync.fromPromise(rm(path, { force: true }), (cause) => new CredentialStoreError(`Could not delete ${path}`, { cause }));

export const createCredentialStore = (options: CredentialStoreOptions): CredentialStore => {
  const path = join(options.dir, 'credentials.json');
  return {
    path,
    read: () => readCredentials(path),
    write: (credentials) => writeCredentials(options.dir, path, credentials),
    remove: () => removeCredentials(path),
  };
};
