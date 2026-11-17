import { createCalendarService } from '@napolab/gct-core/calendar';
import { createGoogleClient } from '@napolab/gct-core/google-client';
import { createTasksService } from '@napolab/gct-core/tasks';
import { createFactory } from 'hono/factory';

import { accessAuth } from '../access-auth';
import { serveMCP } from '../mcp/server';
import { Layout } from '../pages/layout';
import { StatusPage } from '../pages/status-page';
import { createTokenStoreClient } from '../token-store/rpc';
import { createGoogleRoutes } from './google-routes';
import { renderPage } from './render-page';

import type { VerifyAccessToken } from '../access-auth';
import type { HonoEnv } from '../hono-env';
import type { McpAppAssets } from '../mcp/server';
import type { Fetch } from '@napolab/gct-core/google-client';
import type { Now } from '@napolab/gct-core/oauth';

// The Worker's HTTP surface. Everything is behind Cloudflare Access; the entrypoint (src/index.ts) owns the
// long-lived dependencies and injects them here, so tests drive the whole app with fakes through app.request.

export type AppDeps = {
  readonly verifyAccess: VerifyAccessToken;
  readonly fetch: Fetch;
  readonly now: Now;
  // MCP App HTML bundled into the Worker (src/index.ts imports it from the build).
  readonly mcpAppAssets: McpAppAssets;
};

const UnavailablePage = () => (
  <Layout title="Temporarily unavailable">
    <p>The Google connection status could not be read. Reload the page in a moment.</p>
  </Layout>
);

export const createApp = (deps: AppDeps) => {
  const factory = createFactory<HonoEnv>({
    initApp: (app) => {
      app.use(accessAuth({ verify: deps.verifyAccess }));
      app.use(async (c, next) => {
        // This Access user's Durable Object, and core services whose access token comes from it.
        const tokenStore = createTokenStoreClient(c.env.GOOGLE_TOKEN_STORE.getByName(c.var.identity.email));
        const client = createGoogleClient({ fetch: deps.fetch, getAccessToken: tokenStore.getAccessToken });
        c.set('tokenStore', tokenStore);
        c.set('services', { calendar: createCalendarService({ client }), tasks: createTasksService({ client }) });
        await next();
      });
    },
  });

  return factory
    .createApp()
    .get('/', (c) =>
      c.var.tokenStore.status().match(
        (status) => renderPage(c, <StatusPage email={c.var.identity.email} status={status} mcpURL={new URL('/mcp', c.req.url).href} />),
        () => renderPage(c, <UnavailablePage />, 503),
      ),
    )
    .route('/google', createGoogleRoutes(deps))
    .on(['GET', 'POST', 'DELETE'], '/mcp', (c) => serveMCP(c.req.raw, { services: c.var.services, now: deps.now, connectURL: new URL('/google/connect', c.req.url).href }, deps.mcpAppAssets));
};

export type AppType = ReturnType<typeof createApp>;
