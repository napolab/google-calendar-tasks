import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { extraArgsOf, rejectExtraArgs } from './index';

describe('extraArgsOf', () => {
  it('drops the command path and the declared positionals', () => {
    expect(extraArgsOf({ positionals: ['tasks', 'add', 'buy', 'milk'], commandPath: ['tasks', 'add'] }, 1)).toEqual(['milk']);
  });

  it('is empty when every positional is declared', () => {
    expect(extraArgsOf({ positionals: ['events', 'get', 'abc'], commandPath: ['events', 'get'] }, 1)).toEqual([]);
  });
});

describe('rejectExtraArgs', () => {
  it('accepts no extra arguments', () => {
    expect(rejectExtraArgs([]).isOk()).toBe(true);
  });

  it('rejects extra arguments and suggests quoting', () => {
    const error = rejectExtraArgs(['milk'])._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('"milk"');
    expect(error.message).toContain('quote');
  });
});
