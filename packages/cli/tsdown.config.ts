import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: 'esm',
  platform: 'node',
  dts: false,
  // core is a private workspace package whose in-repo exports point at its TypeScript sources (devExports),
  // which plain `node` cannot load; bundle it into the bin so dist/main.mjs runs on its own. dayjs has no
  // `exports` map, so its plugin subpaths (`dayjs/plugin/utc`) are rewritten to real files (`.../utc.js`).
  deps: { alwaysBundle: [/^@napolab\/gct-core(\/|$)/], resolveDepSubpath: true },
  exports: { devExports: true, bin: { gct: './src/main.ts' } },
});
