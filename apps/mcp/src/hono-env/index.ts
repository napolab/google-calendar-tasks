import type { AccessEnv, AccessIdentity } from '../access-auth';
import type { TokenStore, TokenStoreRPC } from '../token-store/rpc';
import type { Services } from '@napolab/gct-core/services';

// The GoogleTokenStore namespace as the app needs it. The entrypoint passes `ctx.exports.GoogleTokenStore` (typed by
// cf from the DO class); tests pass a fake.
export interface TokenStoreNamespace {
  getByName(name: string): TokenStoreRPC;
}

// What the app reads from its bindings (Env narrowed + the DO namespace the entrypoint adds).
export type AppBindings = AccessEnv & {
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly GOOGLE_REDIRECT_URI: string;
  // The task list (title or id) the single-task MCP tools use when `list` is omitted.
  readonly DEFAULT_TASK_LIST: string;
  readonly GOOGLE_TOKEN_STORE: TokenStoreNamespace;
};

// Per-request Variables set in createFactory({ initApp }) (.claude/rules/shared.md), in this order:
// identity (Access JWT) → tokenStore (this user's DO) → services (core services backed by that token store).
export type HonoEnv = {
  Bindings: AppBindings;
  Variables: {
    identity: AccessIdentity;
    tokenStore: TokenStore;
    services: Services;
  };
};
