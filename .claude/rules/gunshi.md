---
description: gunshi commands declare their args inline inside define(); no separate xxxArgs constants
paths:
  - "packages/cli/src/**/*.ts"
---

# gunshi: Args Inline in `define()`

Write each command's `args` as a literal object **inside** `define({ ... })`. Do not hoist them into `xxxArgs` constants and do not assemble them from shared spread fragments (`...jsonArg`, `...listArg`) — repeating a flag definition per command is fine; the command file should read top to bottom as the full CLI surface of that command.

```ts
// Good
export const listEventsCommand = define({
  name: 'list',
  description: 'List events of a calendar',
  args: {
    calendar: { type: 'string', description: "Calendar id (default: 'primary')" },
    from: { type: 'string', description: 'YYYY-MM-DD or RFC 3339 with offset' },
    json: { type: 'boolean', description: 'Print JSON' },
  },
  run: (cmd) => runListEvents(cliContext, cmd.values, cmd.positionals),
});

// Flag value types come from the command itself
type ListEventsValues = ArgValues<(typeof listEventsCommand)['args']>;

// Bad
export const listEventsArgs = { ...calendarArg, ...jsonArg, from: {...} } satisfies Args;
define({ name: 'list', args: listEventsArgs, run: ... });
```

Pure mapping functions (flags → core input) take the value type derived from the command (`ArgValues<(typeof xCommand)['args']>`) or a narrower hand-written input type — never the type of a hoisted args constant.
