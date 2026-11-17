import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { createRunner } from './index';

import type { AsyncPlugin } from './index';

type Input = { readonly tried: readonly string[] };

// Records itself on the input; succeeds only when `succeeds`.
const plugin = (name: string, succeeds: boolean): AsyncPlugin<Input, string> => ({
  run: (input) => (succeeds ? okAsync(name) : errAsync({ tried: [...input.tried, name] })),
});

describe('createRunner', () => {
  it('returns the first plugin that succeeds, in order, without running the rest', async () => {
    const third = { run: () => okAsync('third-should-not-run') };
    const run = createRunner<Input, string>([plugin('first', false), plugin('second', true), third]);

    expect((await run({ tried: [] }))._unsafeUnwrap()).toBe('second');
  });

  it('passes the input each plugin returned on to the next one', async () => {
    const seen: Input[] = [];
    const spy: AsyncPlugin<Input, string> = { run: (input) => (seen.push(input), okAsync('spy')) };

    await createRunner<Input, string>([plugin('first', false), spy])({ tried: [] });

    expect(seen).toEqual([{ tried: ['first'] }]);
  });

  it('fails with the last input when no plugin handles it', async () => {
    const run = createRunner<Input, string>([plugin('first', false), plugin('second', false)]);

    expect((await run({ tried: [] }))._unsafeUnwrapErr()).toEqual({ tried: ['first', 'second'] });
  });

  it('fails with the input itself when there are no plugins', async () => {
    expect((await createRunner<Input, string>([])({ tried: [] }))._unsafeUnwrapErr()).toEqual({ tried: [] });
  });
});
