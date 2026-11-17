import { defineConfig } from 'tsdown';

// Each subpath export is its own entry (no root barrel — .claude/rules/no-barrel.md).
// `devExports: true` points package.json `exports` at src for in-repo consumers (tsx / tsgo / vitest need no build)
// and writes the dist paths to `publishConfig.exports`.
export default defineConfig({
  entry: {
    scopes: 'src/scopes/index.ts',
    errors: 'src/errors/index.ts',
    'google-client': 'src/google-client/index.ts',
    dayjs: 'src/dayjs/index.ts',
    tasks: 'src/tasks/index.ts',
    calendar: 'src/calendar/index.ts',
    services: 'src/services/index.ts',
    oauth: 'src/oauth/index.ts',
  },
  format: 'esm',
  platform: 'neutral',
  dts: true,
  exports: { devExports: true },
});
