---
description: Long-lived resources are created and disposed at the entrypoint and injected — never created inside domain functions
paths:
  - "packages/*/src/**/*.ts"
  - "apps/*/src/**/*.ts"
---

# Long-Lived Resources Belong to the Entrypoint

Anything with a lifetime longer than a single call — HTTP servers (the OAuth loopback server), sockets, timers / AbortSignals, `fetch`, credential stores, Durable Object stubs, Hono `services` — is **created and disposed at the entrypoint** (CLI command handler / `src/main.ts`, the Worker `fetch` / DO class, Hono `initApp`) and **passed in** as a dependency.

Domain functions (`login`, services, tools) only *use* what they are given. They never start, close, or own a resource.

```ts
// Good — entrypoint owns the lifetime
await using loopback = await createLoopbackServer().match(identity, exitWithError);
const signal = AbortSignal.timeout(5 * 60_000);
await login({ loopback, openBrowser, store, config, fetch, signal });

// Bad — login hides a server and a timer inside
const login = async () => {
  const server = http.createServer(...);
  setTimeout(() => server.close(), 300_000);
};
```

Why: lifetimes become visible in one place, cleanup is guaranteed by the owner, and the function becomes testable with a fake (`LoopbackServer`, fake `fetch`) instead of a real port.

## No aggregator factories

Don't wrap the wiring in helper factories (`createServices`, `createConnect`, …) whose body only calls other factories. The entrypoint lists the concrete factories inline, so what gets built — and with which shared `client` / `fetch` — is visible where the lifetimes are owned.

```ts
// main.ts / Hono initApp
const client = createGoogleClient({ fetch, getAccessToken });
const services: Services = { calendar: createCalendarService({ client }), tasks: createTasksService({ client }) };
```
