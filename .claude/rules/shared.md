---
paths:
  - "packages/core/src/**/*.ts"
---

# Core Package Rules (`packages/core`)

`core` is the runtime-agnostic heart of the project, consumed by the CLI (Node) and the MCP server (Cloudflare Workers). Adapted from the `shared/` directory rule of request-invite-system / Genovese.

## Critical Rule: No Runtime-Specific Dependencies

```ts
// ✗ Breaks the Workers bundle
import { readFileSync } from 'node:fs';
import { google } from 'googleapis';

// ✓ Web-standard APIs only — fetch / URL / Request / Response / crypto.subtle
```

Anything that touches the filesystem, the process, a browser, or Workers bindings (token storage, OAuth loopback server, KV) lives in `cli` / `apps/mcp` and is **injected** into core.

## Allowed

- Service interfaces (`ICalendarService`, `ITasksService`) and the `Services` map
- Service factories that take their dependencies as arguments (`createCalendarService({ fetch, getAccessToken })`)
- zod schemas for Google API payloads and tool / command input
- Error classes, constants, pure helpers

## Prohibited

- `node:*`, Workers-only APIs, Google client SDKs (googleapis / google-auth-library)
- Module-level side effects or singletons holding credentials
- Root barrel files — every module is its own tsdown entry / subpath export (`no-barrel.md`)

## Dependency Injection Pattern

```ts
// packages/core/src/services/index.ts — interfaces only
export type Services = {
  readonly calendar: ICalendarService;
  readonly tasks: ITasksService;
};

// apps/mcp — Hono Variables DI (Genovese `shared/callable` style)
type HonoEnv = { Bindings: Env; Variables: { services: Services } };
const factory = createFactory<HonoEnv>({
  initApp(app) {
    app.use(async (c, next) => {
      c.set('services', createServices(c.env, c.var.identity));
      await next();
    });
  },
});
```

Fallible service methods return `ResultAsync<T, E>` where `E` is a union of error classes from `core/errors` (`modeling-errors-as-classes` skill). The CLI / MCP edge folds them with `.match`.
