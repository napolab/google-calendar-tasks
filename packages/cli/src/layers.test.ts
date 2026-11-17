import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Layer rule (src/context/index.ts): commands/** and services/** never import each other; only main.ts sees both.
// oxlint enforces it for production files (.oxlintrc.json overrides); this test also covers test files.

const SRC = dirname(fileURLToPath(import.meta.url));

const IMPORT_PATTERN = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const sourceFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name)).map((entry) => join(entry.parentPath, entry.name));
};

const relativeImports = (code: string): readonly string[] => [...code.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? match[2] ?? '').filter((specifier) => specifier.startsWith('.'));

// `src/`-relative top-level directory each relative import of `file` lands in.
const importedLayers = async (file: string): Promise<readonly string[]> => {
  const code = await readFile(file, 'utf8');
  return relativeImports(code).map((specifier) => relative(SRC, resolve(dirname(file), specifier)).split('/')[0] ?? '');
};

const violations = async (layer: string, forbidden: string): Promise<readonly string[]> => {
  const files = await sourceFiles(join(SRC, layer));
  const checked = await Promise.all(files.map(async (file) => ({ file: relative(SRC, file), layers: await importedLayers(file) })));
  return checked.filter((entry) => entry.layers.includes(forbidden)).map((entry) => entry.file);
};

describe('layers', () => {
  it('commands never import services', async () => {
    expect(await violations('commands', 'services')).toEqual([]);
  });

  it('services never import commands', async () => {
    expect(await violations('services', 'commands')).toEqual([]);
  });

  it('context imports neither commands nor services', async () => {
    expect([...(await violations('context', 'commands')), ...(await violations('context', 'services'))]).toEqual([]);
  });

  it('detects a violation', async () => {
    expect(relativeImports(`import { createAuthService } from '../../services/auth';\nimport type { X } from './x';`)).toEqual(['../../services/auth', './x']);
  });
});
