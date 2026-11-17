import { InvalidInputError } from '@napolab/gct-core/errors';
import { err, ok } from 'neverthrow';

import type { Result } from 'neverthrow';

// gunshi silently drops positionals a command does not declare, so `gct tasks add buy milk` would create a task
// titled "buy". Surplus arguments are rejected instead (.claude/rules/mcp-write-strict.md).

// The parts of gunshi's command context this needs: every positional token, including the command path.
export type PositionalContext = { readonly positionals: readonly string[]; readonly commandPath: readonly string[] };

export const extraArgsOf = (ctx: PositionalContext, declared: number): readonly string[] => ctx.positionals.slice(ctx.commandPath.length + declared);

export const rejectExtraArgs = (extra: readonly string[]): Result<void, InvalidInputError> => {
  if (extra.length === 0) return ok(undefined);
  const quoted = extra.map((arg) => `"${arg}"`).join(', ');
  return err(new InvalidInputError(`Unexpected extra argument(s): ${quoted}. Values with spaces must be quoted, e.g. gct tasks add "buy milk"; options take the form --name value.`));
};
