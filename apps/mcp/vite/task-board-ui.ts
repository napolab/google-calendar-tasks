import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import type { Plugin } from 'vite';

// Build integration of the task board MCP App (src/task-board-ui). `cf build` / `cf deploy` delegate to `vite build`
// with this config, so the UI is built here, inside the Worker build, rather than by a separate package script:
// the Worker entry imports `virtual:task-board-ui`, and this plugin answers it by running a nested Vite build of the UI
// (vite-plugin-singlefile inlines every script and stylesheet) and exporting the resulting HTML as a string.
// The Worker serves that string from resources/read (ui://gct/task-board.html). Nothing is written to disk.

const VIRTUAL_ID = 'virtual:task-board-ui';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

const UI_ROOT = fileURLToPath(new URL('../src/task-board-ui', import.meta.url).href);

type BuildOutput = { readonly output: readonly { readonly type: string; readonly fileName: string; readonly source?: unknown }[] };

const isBuildOutput = (value: unknown): value is BuildOutput => typeof value === 'object' && value !== null && 'output' in value && Array.isArray(value.output);

const htmlOf = (result: unknown): string => {
  const outputs = Array.isArray(result) ? result : [result];
  const html = outputs
    .filter(isBuildOutput)
    .flatMap((output) => output.output)
    .find((file) => file.type === 'asset' && file.fileName === 'index.html');
  if (html === undefined) throw new Error('[task-board-ui] the UI build produced no index.html');
  if (typeof html.source === 'string') return html.source;
  if (html.source instanceof Uint8Array) return new TextDecoder().decode(html.source);
  throw new Error('[task-board-ui] index.html has no source');
};

export const buildTaskBoardHTML = async (): Promise<string> =>
  htmlOf(
    await build({
      configFile: false,
      root: UI_ROOT,
      logLevel: 'warn',
      plugins: [viteSingleFile({ removeViteModuleLoader: true })],
      build: { write: false, outDir: 'dist', emptyOutDir: false, reportCompressedSize: false },
    }),
  );

export const taskBoardUI = (): Plugin => ({
  name: 'gct:task-board-ui',
  resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
  load: async (id) => (id === RESOLVED_ID ? `export default ${JSON.stringify(await buildTaskBoardHTML())};` : undefined),
});
