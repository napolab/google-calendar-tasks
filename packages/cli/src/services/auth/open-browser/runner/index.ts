import { errAsync } from 'neverthrow';

import type { ResultAsync } from 'neverthrow';

// First-match processor (.claude/skills/prefix-match-processor), async: each plugin either handles the input
// (`ok`) or hands it on (`err(input)`, possibly enriched — e.g. with why it could not handle it).

export interface AsyncPlugin<I, T> {
  run(input: I): ResultAsync<T, I>;
}

const runFrom = <I, T>(input: I, plugins: readonly AsyncPlugin<I, T>[]): ResultAsync<T, I> => {
  const [head, ...tail] = plugins;
  if (head === undefined) return errAsync(input);
  return head.run(input).orElse((next) => runFrom(next, tail));
};

// Tries the plugins in order (most specific first); the first `ok` wins and the rest never run.
export const createRunner =
  <I, T>(plugins: readonly AsyncPlugin<I, T>[]) =>
  (input: I): ResultAsync<T, I> =>
    runFrom(input, plugins);
