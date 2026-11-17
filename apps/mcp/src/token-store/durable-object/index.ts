import { dayjs } from '@napolab/gct-core/dayjs';
import { DurableObject } from 'cloudflare:workers';

import { createTokenStoreRPC } from '../rpc';
import { createTokenVault } from '../vault';

import type { AuthorizationStart } from '../pending-authorization';
import type { AccessTokenReply, AuthorizationReply, TokenStoreRPC } from '../rpc';
import type { ConnectionStatus, Disconnection, NewConnection } from '../vault';

// One instance per Cloudflare Access email (`idFromName(email)`), SQLite-backed (cloudflare.config.ts exports).
// Thin by design: it owns the lifetimes (storage, fetch, clock, client credentials) and forwards every RPC to the
// vault (../vault, tested in isolation) through the plain-reply adapter (../rpc).
export class GoogleTokenStore extends DurableObject<Env> implements TokenStoreRPC {
  readonly #rpc: TokenStoreRPC;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const vault = createTokenVault({
      storage: { get: async (key) => ctx.storage.get(key), put: async (key, value) => ctx.storage.put(key, value), delete: async (keys) => ctx.storage.delete(keys) },
      fetch: async (input, init) => fetch(input, init),
      now: () => dayjs().valueOf(),
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    });
    this.#rpc = createTokenStoreRPC(vault);
  }

  async status(): Promise<ConnectionStatus> {
    return this.#rpc.status();
  }

  async startAuthorization(start: AuthorizationStart): Promise<void> {
    return this.#rpc.startAuthorization(start);
  }

  async consumeAuthorization(state: string): Promise<AuthorizationReply> {
    return this.#rpc.consumeAuthorization(state);
  }

  async saveConnection(connection: NewConnection): Promise<void> {
    return this.#rpc.saveConnection(connection);
  }

  async getAccessToken(): Promise<AccessTokenReply> {
    return this.#rpc.getAccessToken();
  }

  async disconnect(): Promise<Disconnection> {
    return this.#rpc.disconnect();
  }
}
