import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { toCreateTaskListInput, toDeleteTaskListName, toRenameTaskListInput } from './index';

describe('toCreateTaskListInput', () => {
  it('passes a title through unchanged', () => {
    expect(toCreateTaskListInput(' Work ')._unsafeUnwrap()).toEqual({ title: ' Work ' });
  });

  it('rejects a blank title', () => {
    const error = toCreateTaskListInput('  ')._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('task list title');
  });
});

describe('toRenameTaskListInput', () => {
  it('targets a named list with the new title', () => {
    expect(toRenameTaskListInput('Work', 'Office')._unsafeUnwrap()).toEqual({ list: { kind: 'named', name: 'Work' }, input: { title: 'Office' } });
  });

  it('targets the default list for @default without a lookup', () => {
    expect(toRenameTaskListInput('@default', 'Inbox')._unsafeUnwrap()).toEqual({ list: { kind: 'default' }, input: { title: 'Inbox' } });
  });

  it('rejects a blank new title', () => {
    expect(toRenameTaskListInput('Work', '')._unsafeUnwrapErr()).toBeInstanceOf(InvalidInputError);
  });
});

describe('toDeleteTaskListName', () => {
  it('returns the list title or id to resolve', () => {
    expect(toDeleteTaskListName('Work')._unsafeUnwrap()).toBe('Work');
  });

  it('rejects @default: the default task list cannot be deleted', () => {
    const error = toDeleteTaskListName('@default')._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('default task list cannot be deleted');
  });
});
