import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { createRunner } from './index';

import type { Plugin } from './index';

const prefixPlugin = (prefix: string, calls: string[]): Plugin<string, string> => ({
  run: (input) => {
    calls.push(prefix);
    return input.startsWith(prefix) ? ok(`${prefix}:${input}`) : err(input);
  },
});

describe('createRunner', () => {
  it('returns the first plugin that handles the input and skips the rest', () => {
    const calls: string[] = [];
    const run = createRunner([prefixPlugin('edit.image.', calls), prefixPlugin('edit.', calls), prefixPlugin('e', calls)]);

    expect(run('edit.undo')._unsafeUnwrap()).toBe('edit.:edit.undo');
    expect(calls).toEqual(['edit.image.', 'edit.']);
  });

  it('hands the input back when no plugin handles it', () => {
    expect(createRunner([prefixPlugin('edit.', [])])('view.zoom')._unsafeUnwrapErr()).toBe('view.zoom');
    expect(createRunner<string, string>([])('x')._unsafeUnwrapErr()).toBe('x');
  });
});
