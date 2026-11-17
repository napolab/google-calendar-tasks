import type { Args } from 'gunshi';

// `--json` on every command that prints a result: print the core result as JSON instead of text.
export const jsonArg = {
  json: { type: 'boolean', description: 'Print the result as JSON' },
} satisfies Args;
