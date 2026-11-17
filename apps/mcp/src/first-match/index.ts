import { err } from 'neverthrow';

import type { Result } from 'neverthrow';

// First-match processor (.claude/skills/prefix-match-processor): each plugin either handles the input (`ok`) or
// hands it back unchanged (`err(input)`). Local to apps/mcp until core offers a shared runner.

export interface Plugin<I, T> {
  run(input: I): Result<T, I>;
}

const runFrom = <I, T>(input: I, plugins: readonly Plugin<I, T>[]): Result<T, I> => {
  const [head, ...tail] = plugins;
  if (head === undefined) return err(input);
  return head.run(input).orElse((next) => runFrom(next, tail));
};

// Tries the plugins in order (most specific first); the first `ok` wins and the rest never run.
export const createRunner =
  <I, T>(plugins: readonly Plugin<I, T>[]) =>
  (input: I): Result<T, I> =>
    runFrom(input, plugins);
