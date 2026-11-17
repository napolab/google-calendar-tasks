import { dayjs } from '@napolab/gct-core/dayjs';

import { createJoseVerifier, remoteAccessKeys } from './access-auth';
import { createApp } from './app';

import type { AppBindings } from './hono-env';

export { GoogleTokenStore } from './token-store/durable-object';

// Entrypoint: owns the isolate-lifetime dependencies (the Access JWKS cache, fetch, the clock) and wires the per-request
// ones (bindings + this Worker's own GoogleTokenStore namespace from ctx.exports) into the app.
const app = createApp({
  verifyAccess: createJoseVerifier({ keysFor: remoteAccessKeys }),
  // Wrapped: a detached global fetch throws "Illegal invocation" on Workers.
  fetch: async (input, init) => fetch(input, init),
  now: () => dayjs().valueOf(),
});

const bindingsFor = (env: Env, ctx: ExecutionContext): AppBindings => ({
  CF_ACCESS_TEAM_DOMAIN: env.CF_ACCESS_TEAM_DOMAIN,
  CF_ACCESS_AUD: env.CF_ACCESS_AUD,
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI,
  GOOGLE_TOKEN_STORE: ctx.exports.GoogleTokenStore,
});

export default {
  fetch: async (request, env, ctx) => app.fetch(request, bindingsFor(env, ctx), ctx),
} satisfies ExportedHandler<Env>;
