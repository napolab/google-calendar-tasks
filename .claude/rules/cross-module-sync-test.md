# Cross-Module Constant Sync: Assert With a Test

When two modules must keep a list/constant in 1:1 sync, a comment saying "keep in sync with X" is not enforcement. Export the canonical value from one side and assert equality in a test that imports both.

## Pattern

```typescript
// side A (canonical or co-canonical) — export the list
export const PRELOADED_LANGUAGE_KEYS = ['typescript', 'tsx', 'css', 'json', 'bash'] as const;

// side B's test — import both, assert 1:1
expect(Object.keys(CODE_LANGUAGES)).toEqual([...PRELOADED_LANGUAGE_KEYS]);
```

A hand-copied literal in the test (`toEqual(['typescript', ...])`) only pins one side — it does not fail when the *other* module drifts. The assertion must import from both modules.

## When a Literal Cannot Be Derived

Some values must stay literal for tooling (e.g. dynamic `import('@shikijs/langs/typescript')` paths must be literal for the bundler). In that case keep the literal AND the exported list adjacent in the same file with a comment binding them, and let the cross-module test cover the inter-module drift.

## Known Sync Pairs in This Repo

| Side A | Side B (test) |
| ------ | ------------- |
| `VALID_IDS_FROM` (`apps/mcp/src/mcp/tool-result/error-messages`) — the `list_*` tools a 404 hint names | `MCP_TOOL_NAMES` (`apps/mcp/src/mcp/server`), asserted in `error-messages.test.ts` |
| `buildServerInstructions` (`apps/mcp/src/mcp/server-instructions`) — every snake_case tool name in the server instructions, and the "sendUpdates unset = no email" claim | `MCP_TOOL_NAMES` (`apps/mcp/src/mcp/server`) and `toSendUpdates` (`apps/mcp/src/mcp/calendar/shared`), asserted in `server-instructions.test.ts` |
| `DefaultTaskListNotFoundError` (`apps/mcp/src/errors`) — the tools its message names | `MCP_TOOL_NAMES` (`apps/mcp/src/mcp/server`), asserted in `error-messages.test.ts` |
| `buildServerInstructions` board line (`apps/mcp/src/mcp/server-instructions`) — the `[status: todo]` / `[status: doing]` tag spelling | `writeStatusTag` (`@napolab/gct-core/tasks`), asserted in `server-instructions.test.ts` |

Add new pairs to this table when you introduce one. When the two sides live in different workspaces, import the other side through its package subpath export.
