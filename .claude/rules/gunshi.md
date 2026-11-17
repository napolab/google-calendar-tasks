---
description: gunshi commands declare their args inline inside define(); no separate xxxArgs constants
paths:
  - "packages/cli/src/**/*.ts"
---

# gunshi: Args Inline in `define()`

Write each command's `args` as a literal object **inside** `define({ ... })`. Do not hoist them into `xxxArgs` constants and do not assemble them from shared spread fragments (`...jsonArg`, `...listArg`) — repeating a flag definition per command is fine; the command file should read top to bottom as the full CLI surface of that command.

Commands receive `CliContext` from a factory (entrypoint-owned dependencies), so each (sub)command is its own exported factory and value types are derived from it:

```ts
// Good
export const createListEventsCommand = (context: CliContext) =>
  define({
    name: 'list',
    description: 'List events of a calendar',
    args: {
      calendar: { type: 'string', description: "Calendar id (default: 'primary')" },
      from: { type: 'string', description: 'YYYY-MM-DD or RFC 3339 with offset' },
      json: { type: 'boolean', description: 'Print JSON' },
    },
    // `: Promise<void>` is required: the handler's parameter type is derived from this command,
    // so without an explicit return type TypeScript reports a circular type (TS2502 / TS7022 / TS7023).
    run: (ctx): Promise<void> => runListEvents(context, ctx.values, ctx.positionals),
  });

// Flag value types come from the command itself
export type ListEventsValues = ArgValues<ReturnType<typeof createListEventsCommand>['args']>;

// Bad
export const listEventsArgs = { ...calendarArg, ...jsonArg, from: {...} } satisfies Args;
define({ name: 'list', args: listEventsArgs, run: ... });
```

Pure mapping functions (flags → core input) take the value type derived from the command (`XValues`, or a `Pick`/`Omit` of it) or a narrower hand-written input type — never the type of a hoisted args constant.
