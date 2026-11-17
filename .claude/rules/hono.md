---
description: Hono apps are built as a single method chain; the AppType is derived from that chain
paths:
  - "packages/*/src/**/*.{ts,tsx}"
  - "apps/*/src/**/*.{ts,tsx}"
---

# Hono: Chain Routes, Derive the AppType

Build every Hono app (and sub-router) as **one method chain that is returned directly**, and export its type with `ReturnType`. Statement-style registration (`app.get(...)` on separate lines) loses the route types that `hc<AppType>` / RPC inference depend on.

```ts
// Good
export const createCallbackApp = (deps: CallbackAppDeps) =>
  new Hono()
    .get('/callback', zValidator('query', callbackQuerySchema), (c) => c.html(<CallbackPage result={...} />))
    .notFound((c) => c.html(<CallbackPage result={{ kind: 'ignored' }} />, 404));

export type CallbackAppType = ReturnType<typeof createCallbackApp>;

// Good — composition keeps chaining
export const createApp = (services: Services) =>
  factory.createApp().route('/calendar', calendarRoutes).route('/tasks', tasksRoutes);
export type AppType = ReturnType<typeof createApp>;

// Bad
const app = new Hono();
app.get('/callback', handler);
app.post('/x', handler);
export default app;
```

- Services are injected through `Variables` (`c.set('services', ...)` in `createFactory({ initApp })`), see `shared.md`.
- Validate inputs with `zValidator` in the chain, not by hand inside handlers.
