import { bindings, defineConfig, exports } from 'cf/config';

import * as entrypoint from './src/index.ts' with { type: 'cf-worker' };

const ACCOUNT_ID = 'cda8b0a2b410e1ff3a5bcc72c7e46f72';
const ACCESS_TEAM = 'napochaan';

// OAuth client "gct-mcp-worker" (Web application) in the Google Cloud project gct-mcp. The client id is public
// (it appears in every authorization URL); the client secret is a Worker secret (`cf workers secrets update`).
const GOOGLE_CLIENT_ID = '888995174857-d9edsvvhd038midk2j7gme5f1o8npunh.apps.googleusercontent.com';

type ModeSettings = {
  readonly name: string;
  readonly access: { readonly teamDomain: string; readonly aud: string };
  readonly redirectURI: string;
};

// One complete Worker per mode (cf does not merge environment blocks), built from the per-mode settings.
const workerFor = (settings: ModeSettings) => ({
  name: settings.name,
  compatibilityDate: '2026-11-01',
  compatibilityFlags: ['nodejs_compat'],
  entrypoint,
  observability: { enabled: true },
  exports: {
    // One instance per Cloudflare Access email (idFromName): the Google refresh token, cached access token and
    // the pending OAuth state of that user. The Worker reaches it through `ctx.exports.GoogleTokenStore`, which
    // cf types from the entrypoint (an env binding by Worker name would only give an untyped stub).
    GoogleTokenStore: exports.durableObject({ storage: 'sqlite' }),
  },
  env: {
    CF_ACCESS_TEAM_DOMAIN: bindings.text(settings.access.teamDomain),
    CF_ACCESS_AUD: bindings.text(settings.access.aud),
    GOOGLE_CLIENT_ID: bindings.text(GOOGLE_CLIENT_ID),
    GOOGLE_REDIRECT_URI: bindings.text(settings.redirectURI),
    GOOGLE_CLIENT_SECRET: bindings.secret(),
  },
});

// `cf deploy --mode staging` → gct-mcp-stg on gct-stg.napochaan.com behind Cloudflare Access.
// `cf deploy --mode production` → gct-mcp on gct.napochaan.com behind Cloudflare Access.
export default defineConfig(({ mode }) => {
  switch (mode) {
    case 'production':
      return {
        accountId: ACCOUNT_ID,
        worker: {
          ...workerFor({
            name: 'gct-mcp',
            // AUD tag of the host-wide Access app "gct-mcp" (id 587bfc02…) for gct.napochaan.com
            access: { teamDomain: ACCESS_TEAM, aud: '9b831caefc41ef4cf7fbcfdfa91d3c70e6ab9f730d130200371958cb3b78fe42' },
            redirectURI: 'https://gct.napochaan.com/google/callback',
          }),
          workersDev: false,
          domains: ['gct.napochaan.com'],
        },
      };
    case 'staging':
      return {
        accountId: ACCOUNT_ID,
        worker: {
          ...workerFor({
            name: 'gct-mcp-stg',
            // AUD tag of the host-wide Access app "gct-mcp-stg" (id 5659f356…) for gct-stg.napochaan.com
            access: { teamDomain: ACCESS_TEAM, aud: '3edb157ca2e57cbf1474078ce4f0317a0c76e6753106547ce10ece8450d06be8' },
            redirectURI: 'https://gct-stg.napochaan.com/google/callback',
          }),
          workersDev: false,
          domains: ['gct-stg.napochaan.com'],
        },
      };
    default:
      // Local dev: Access settings empty, so every request fails closed (500).
      return {
        accountId: ACCOUNT_ID,
        worker: workerFor({ name: 'gct-mcp-dev', access: { teamDomain: '', aud: '' }, redirectURI: 'http://localhost:5173/google/callback' }),
      };
  }
});
