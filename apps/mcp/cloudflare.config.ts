import { bindings, defineConfig } from 'cf/config';

import * as entrypoint from './src/index.ts' with { type: 'cf-worker' };

const ACCOUNT_ID = 'cda8b0a2b410e1ff3a5bcc72c7e46f72';
const ACCESS_TEAM = 'napochaan';

// One complete config per mode (cf does not merge environment blocks).
// `cf deploy --mode staging` → gct-mcp-stg on gct-stg.napochaan.com behind Cloudflare Access.
export default defineConfig(({ mode }) => {
  switch (mode) {
    case 'staging':
      return {
        accountId: ACCOUNT_ID,
        worker: {
          name: 'gct-mcp-stg',
          compatibilityDate: '2026-11-01',
          compatibilityFlags: ['nodejs_compat'],
          entrypoint,
          observability: { enabled: true },
          workersDev: false,
          domains: ['gct-stg.napochaan.com'],
          env: {
            CF_ACCESS_TEAM_DOMAIN: bindings.text(ACCESS_TEAM),
            // AUD tag of the host-wide Access app "gct-mcp-stg" (id 5659f356…) for gct-stg.napochaan.com
            CF_ACCESS_AUD: bindings.text('3edb157ca2e57cbf1474078ce4f0317a0c76e6753106547ce10ece8450d06be8'),
          },
        },
      };
    default:
      // Local dev: Access settings empty, so every Access check fails closed.
      return {
        accountId: ACCOUNT_ID,
        worker: {
          name: 'gct-mcp-dev',
          compatibilityDate: '2026-11-01',
          compatibilityFlags: ['nodejs_compat'],
          entrypoint,
          observability: { enabled: true },
          env: {
            CF_ACCESS_TEAM_DOMAIN: bindings.text(''),
            CF_ACCESS_AUD: bindings.text(''),
          },
        },
      };
  }
});
