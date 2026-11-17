import type { Now } from '@napolab/gct-core/oauth';
import type { Services } from '@napolab/gct-core/services';

// What every tool handler is given for one MCP request (built per request in the Hono app).
export type ToolDeps = {
  readonly services: Services;
  // Epoch milliseconds; date defaults (e.g. list_events → now..+7d) are computed from it.
  readonly now: Now;
  // Absolute URL of GET /google/connect on this host, quoted in "connect Google first" errors.
  readonly connectURL: string;
};
