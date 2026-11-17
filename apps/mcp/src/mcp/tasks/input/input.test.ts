import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import {
  createTaskListArgs,
  deleteTaskListArgs,
  renameTaskListArgs,
  toCreateTaskInput,
  clearCompletedTasksArgs,
  moveTaskArgs,
  toClearTaskListTarget,
  toCreateTaskListInput,
  toDeleteTaskListName,
  toMoveTaskRequest,
  toListTasksQuery,
  toRenameTaskListInput,
  toTaskRef,
  toUpdateTaskInput,
} from './index';

import type { CreateTaskArgs, ListTasksArgs, MoveTaskArgs, UpdateTaskArgs } from './index';

const messageOf = (result: { _unsafeUnwrapErr: () => Error }) => {
  const error = result._unsafeUnwrapErr();
  expect(error).toBeInstanceOf(InvalidInputError);
  return error.message;
};

const OPTIONS = { due: { kind: 'any' }, completed: 'include', completedAt: { kind: 'any' }, updated: { kind: 'any' }, deleted: 'exclude', assigned: 'exclude', maxResults: 100 };

describe('toListTasksQuery', () => {
  it('reads every list with completed tasks included and 100 per list by default', () => {
    expect(toListTasksQuery({})._unsafeUnwrap()).toEqual({ kind: 'all', options: OPTIONS });
  });

  it('reads one list (a title or id to resolve) with its page', () => {
    expect(toListTasksQuery({ list: 'Work', pageToken: 'p2', completed: 'exclude', maxResults: 20 })._unsafeUnwrap()).toEqual({
      kind: 'one',
      list: { kind: 'named', name: 'Work' },
      page: { kind: 'token', pageToken: 'p2' },
      options: { due: { kind: 'any' }, completed: 'exclude', completedAt: { kind: 'any' }, updated: { kind: 'any' }, deleted: 'exclude', assigned: 'exclude', maxResults: 20 },
    });
  });

  it("treats '@default' as the default list (no lookup)", () => {
    expect(toListTasksQuery({ list: '@default' })._unsafeUnwrap()).toMatchObject({ kind: 'one', list: { kind: 'default' }, page: { kind: 'first' } });
  });

  it.each<[ListTasksArgs, unknown]>([
    [{ dueFrom: '2026-11-17' }, { kind: 'from', dueMin: '2026-11-17' }],
    [{ dueTo: '2026-11-30' }, { kind: 'until', dueMax: '2026-11-30' }],
    [
      { dueFrom: '2026-11-17', dueTo: '2026-11-30' },
      { kind: 'between', dueMin: '2026-11-17', dueMax: '2026-11-30' },
    ],
  ])('maps the due filter (%#)', (args, due) => {
    expect(toListTasksQuery(args)._unsafeUnwrap()).toMatchObject({ options: { due } });
  });

  it.each<[ListTasksArgs, string]>([
    [{ pageToken: 'p2' }, 'list'],
    [{ dueFrom: '17 Nov' }, '17 Nov'],
    [{ dueFrom: '2026-11-30', dueTo: '2026-11-17' }, 'dueTo'],
  ])('rejects invalid input (%#)', (args, expected) => {
    expect(messageOf(toListTasksQuery(args))).toContain(expected);
  });
});

describe('toListTasksQuery API filters', () => {
  it('includes deleted / assigned tasks on request', () => {
    expect(toListTasksQuery({ showDeleted: true, showAssigned: true })._unsafeUnwrap()).toMatchObject({ options: { deleted: 'include', assigned: 'include' } });
  });

  it.each<[ListTasksArgs, unknown]>([
    [{ updatedMin: '2026-11-17T10:00:00+09:00' }, { kind: 'since', updatedMin: '2026-11-17T10:00:00+09:00' }],
    [{ updatedMin: '2026-11-17' }, { kind: 'since', updatedMin: '2026-11-17T00:00:00+09:00' }],
  ])('maps updatedMin (%#): a day starts at midnight Asia/Tokyo', (args, updated) => {
    expect(toListTasksQuery(args)._unsafeUnwrap()).toMatchObject({ options: { updated } });
  });

  it.each<[ListTasksArgs, unknown]>([
    [{ completedMin: '2026-11-01' }, { kind: 'from', completedMin: '2026-11-01T00:00:00+09:00' }],
    [{ completedMax: '2026-11-30' }, { kind: 'until', completedMax: '2026-12-01T00:00:00+09:00' }],
    [
      { completedMin: '2026-11-17T09:00:00Z', completedMax: '2026-11-17T10:00:00Z' },
      { kind: 'between', completedMin: '2026-11-17T09:00:00Z', completedMax: '2026-11-17T10:00:00Z' },
    ],
    [
      { completedMin: '2026-11-17', completedMax: '2026-11-17' },
      { kind: 'between', completedMin: '2026-11-17T00:00:00+09:00', completedMax: '2026-11-18T00:00:00+09:00' },
    ],
  ])('maps completedMin / completedMax (%#): a completedMax day is inclusive', (args, completedAt) => {
    expect(toListTasksQuery(args)._unsafeUnwrap()).toMatchObject({ options: { completedAt } });
  });

  it.each<[ListTasksArgs, readonly string[]]>([
    [{ updatedMin: 'yesterday' }, ['updatedMin', 'yesterday', 'RFC 3339']],
    [{ completedMin: '2026-11-17T10:00:00' }, ['completedMin', 'offset']],
    [{ completedMin: '2026-11-30', completedMax: '2026-11-01' }, ['completedMax "2026-11-01"', 'completedMin "2026-11-30"']],
    [{ completed: 'exclude', completedMin: '2026-11-01' }, ['completedMin', "'exclude'", "'include'"]],
  ])('rejects invalid filters (%#)', (args, expected) => {
    const message = messageOf(toListTasksQuery(args));
    for (const text of expected) expect(message).toContain(text);
  });
});

describe('toMoveTaskRequest', () => {
  const move = (args: Omit<MoveTaskArgs, 'taskId'>) => toMoveTaskRequest({ taskId: 't1', ...args });

  it('moves a task to the top of its own (default) list when nothing else is given', () => {
    expect(move({})._unsafeUnwrap()).toEqual({
      list: { kind: 'default' },
      destination: { kind: 'sameList' },
      input: { taskId: 't1', placement: { kind: 'root', position: { kind: 'first' } } },
    });
  });

  it('maps parentId / previousId to the placement', () => {
    expect(move({ list: 'Work', parentId: 'p1', previousId: 's1' })._unsafeUnwrap()).toEqual({
      list: { kind: 'named', name: 'Work' },
      destination: { kind: 'sameList' },
      input: { taskId: 't1', placement: { kind: 'subtask', parentId: 'p1', position: { kind: 'after', previousId: 's1' } } },
    });
    expect(move({ previousId: 's1' })._unsafeUnwrap().input.placement).toEqual({ kind: 'root', position: { kind: 'after', previousId: 's1' } });
  });

  it('moves to another list (a title, an id or @default) unless it names the same list', () => {
    expect(move({ list: 'Work', destinationList: 'Home' })._unsafeUnwrap().destination).toEqual({ kind: 'otherList', list: { kind: 'named', name: 'Home' } });
    expect(move({ list: 'Work', destinationList: '@default' })._unsafeUnwrap().destination).toEqual({ kind: 'otherList', list: { kind: 'default' } });
    expect(move({ list: 'Work', destinationList: 'Work' })._unsafeUnwrap().destination).toEqual({ kind: 'sameList' });
    expect(move({ destinationList: '@default' })._unsafeUnwrap().destination).toEqual({ kind: 'sameList' });
  });

  it.each<[Omit<MoveTaskArgs, 'taskId'>, string]>([
    [{ parentId: 't1' }, 'parentId'],
    [{ previousId: 't1' }, 'previousId'],
  ])('rejects the task itself as its own %s', (args, field) => {
    const message = messageOf(move(args));
    expect(message).toContain(field);
    expect(message).toContain('"t1"');
  });

  it('rejects unknown keys', () => {
    expect(moveTaskArgs.safeParse({ taskId: 't1', destination: 'Work' }).success).toBe(false);
  });
});

describe('toClearTaskListTarget', () => {
  it('requires the confirm literal and a list', () => {
    expect(clearCompletedTasksArgs.safeParse({ list: 'Work', confirm: 'clear-completed' }).success).toBe(true);
    expect(clearCompletedTasksArgs.safeParse({ list: 'Work' }).success).toBe(false);
    expect(clearCompletedTasksArgs.safeParse({ list: 'Work', confirm: 'yes' }).success).toBe(false);
    expect(clearCompletedTasksArgs.safeParse({ confirm: 'clear-completed' }).success).toBe(false);
  });

  it('targets a named list, or the default list for @default', () => {
    expect(toClearTaskListTarget({ list: 'Work', confirm: 'clear-completed' })._unsafeUnwrap()).toEqual({ kind: 'named', name: 'Work' });
    expect(toClearTaskListTarget({ list: '@default', confirm: 'clear-completed' })._unsafeUnwrap()).toEqual({ kind: 'default' });
  });

  it('rejects a blank list', () => {
    expect(messageOf(toClearTaskListTarget({ list: '  ', confirm: 'clear-completed' }))).toContain('"  "');
  });
});

describe('toTaskRef', () => {
  it('targets the default list unless one is named', () => {
    expect(toTaskRef({ taskId: 't1' })).toEqual({ list: { kind: 'default' }, input: { taskId: 't1' } });
    expect(toTaskRef({ taskId: 't1', list: 'Work' })).toEqual({ list: { kind: 'named', name: 'Work' }, input: { taskId: 't1' } });
  });
});

describe('toCreateTaskInput', () => {
  it('creates a root task first in the default list by default', () => {
    expect(toCreateTaskInput({ title: 'Buy milk' })._unsafeUnwrap()).toEqual({
      list: { kind: 'default' },
      input: { title: 'Buy milk', notes: '', due: { kind: 'none' }, placement: { kind: 'root', position: { kind: 'first' } } },
    });
  });

  it('maps notes, due and placement', () => {
    expect(toCreateTaskInput({ title: 'Step', list: 'Work', notes: 'n', due: '2026-11-20', parentId: 'p1', previousId: 's1' })._unsafeUnwrap()).toEqual({
      list: { kind: 'named', name: 'Work' },
      input: { title: 'Step', notes: 'n', due: { kind: 'date', date: '2026-11-20' }, placement: { kind: 'subtask', parentId: 'p1', position: { kind: 'after', previousId: 's1' } } },
    });
  });

  it.each<[CreateTaskArgs, string]>([
    [{ title: ' ' }, 'title'],
    [{ title: 'x', due: '2026-11-20T10:00:00+09:00' }, 'YYYY-MM-DD'],
  ])('rejects invalid input (%#)', (args, expected) => {
    expect(messageOf(toCreateTaskInput(args))).toContain(expected);
  });
});

describe('toUpdateTaskInput', () => {
  it('keeps what is not mentioned', () => {
    expect(toUpdateTaskInput({ taskId: 't1', title: 'New' })._unsafeUnwrap()).toEqual({
      list: { kind: 'default' },
      input: { taskId: 't1', title: { kind: 'set', value: 'New' }, notes: { kind: 'keep' }, due: { kind: 'keep' } },
    });
  });

  it('sets and clears', () => {
    expect(toUpdateTaskInput({ taskId: 't1', list: 'Work', notes: 'n', clearDue: true })._unsafeUnwrap()).toEqual({
      list: { kind: 'named', name: 'Work' },
      input: { taskId: 't1', title: { kind: 'keep' }, notes: { kind: 'set', value: 'n' }, due: { kind: 'clear' } },
    });
    expect(toUpdateTaskInput({ taskId: 't1', due: '2026-11-21', clearNotes: true })._unsafeUnwrap().input).toMatchObject({ notes: { kind: 'clear' }, due: { kind: 'set', value: '2026-11-21' } });
  });

  it.each<[UpdateTaskArgs, string]>([
    [{ taskId: 't1' }, 'complete_task'],
    [{ taskId: 't1', title: '' }, 'title'],
    [{ taskId: 't1', notes: '' }, 'clearNotes'],
    [{ taskId: 't1', due: 'friday' }, 'friday'],
    [{ taskId: 't1', due: '2026-11-21', clearDue: true }, 'clearDue'],
  ])('rejects an ambiguous or invalid patch (%#)', (args, expected) => {
    expect(messageOf(toUpdateTaskInput(args))).toContain(expected);
  });
});

describe('task list arguments', () => {
  it('require list for rename and delete, and reject unknown keys', () => {
    expect(renameTaskListArgs.safeParse({ title: 'x' }).success).toBe(false);
    expect(deleteTaskListArgs.safeParse({}).success).toBe(false);
    expect(deleteTaskListArgs.safeParse({ list: '' }).success).toBe(false);
    expect(createTaskListArgs.safeParse({ title: 'x', name: 'y' }).success).toBe(false);
  });
});

describe('toCreateTaskListInput', () => {
  it('passes the title through', () => {
    expect(toCreateTaskListInput({ title: 'Errands' })._unsafeUnwrap()).toEqual({ title: 'Errands' });
  });

  it('rejects a blank title', () => {
    expect(messageOf(toCreateTaskListInput({ title: '\t' }))).toContain('task list title');
  });
});

describe('toRenameTaskListInput', () => {
  it('targets a named list, or the default list for @default', () => {
    expect(toRenameTaskListInput({ list: 'Work', title: 'Office' })._unsafeUnwrap()).toEqual({ list: { kind: 'named', name: 'Work' }, input: { title: 'Office' } });
    expect(toRenameTaskListInput({ list: '@default', title: 'Inbox' })._unsafeUnwrap()).toEqual({ list: { kind: 'default' }, input: { title: 'Inbox' } });
  });

  it('rejects a blank title', () => {
    expect(messageOf(toRenameTaskListInput({ list: 'Work', title: ' ' }))).toContain('task list title');
  });
});

describe('toDeleteTaskListName', () => {
  it('returns the list title or id to resolve', () => {
    expect(toDeleteTaskListName({ list: 'Work' })._unsafeUnwrap()).toBe('Work');
  });

  it('rejects @default', () => {
    expect(messageOf(toDeleteTaskListName({ list: '@default' }))).toContain('default task list cannot be deleted');
  });
});
