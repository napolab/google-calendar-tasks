import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { toCreateTaskInput, toListTasksQuery, toTaskRef, toUpdateTaskInput } from './index';

describe('toListTasksQuery', () => {
  const OPTIONS = { due: { kind: 'any' }, completed: 'include', maxResults: 100 };

  it('lists every task list by default, with any due date', () => {
    expect(toListTasksQuery({ completed: 'include', max: 100 })._unsafeUnwrap()).toEqual({ kind: 'all', options: OPTIONS });
  });

  it('maps --completed hidden to includeHidden', () => {
    expect(toListTasksQuery({ completed: 'hidden', max: 100 })._unsafeUnwrap().options.completed).toBe('includeHidden');
  });

  it('maps the due range', () => {
    expect(toListTasksQuery({ completed: 'include', max: 100, dueFrom: '2026-11-17' })._unsafeUnwrap().options.due).toEqual({ kind: 'from', dueMin: '2026-11-17' });
    expect(toListTasksQuery({ completed: 'include', max: 100, dueTo: '2026-11-30' })._unsafeUnwrap().options.due).toEqual({ kind: 'until', dueMax: '2026-11-30' });
    expect(toListTasksQuery({ completed: 'include', max: 100, dueFrom: '2026-11-17', dueTo: '2026-11-30' })._unsafeUnwrap().options.due).toEqual({
      kind: 'between',
      dueMin: '2026-11-17',
      dueMax: '2026-11-30',
    });
  });

  it('maps --list (a title or id, kept unresolved), --max and --page-token to one list', () => {
    expect(toListTasksQuery({ completed: 'exclude', max: 20, list: '日常タスク', pageToken: 'tok' })._unsafeUnwrap()).toEqual({
      kind: 'one',
      list: { kind: 'named', name: '日常タスク' },
      page: { kind: 'token', pageToken: 'tok' },
      options: { due: { kind: 'any' }, completed: 'exclude', maxResults: 20 },
    });
  });

  it('maps --list @default to the default list without a name to resolve', () => {
    expect(toListTasksQuery({ completed: 'include', max: 100, list: '@default' })._unsafeUnwrap()).toEqual({ kind: 'one', list: { kind: 'default' }, page: { kind: 'first' }, options: OPTIONS });
  });

  it('rejects --page-token without --list, since a page token belongs to one list', () => {
    const error = toListTasksQuery({ completed: 'include', max: 100, pageToken: 'tok' })._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--page-token');
    expect(error.message).toContain('--list');
  });

  it('rejects a malformed due date, naming the flag', () => {
    const error = toListTasksQuery({ completed: 'include', max: 100, dueFrom: '2026/11/17' })._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--due-from "2026/11/17"');
  });
});

describe('toCreateTaskInput', () => {
  it('creates a root task first in the default list without notes or due', () => {
    expect(toCreateTaskInput('Buy milk', {})._unsafeUnwrap()).toEqual({
      list: { kind: 'default' },
      input: { title: 'Buy milk', notes: '', due: { kind: 'none' }, placement: { kind: 'root', position: { kind: 'first' } } },
    });
  });

  it('maps notes, due, list and a subtask placed after a sibling', () => {
    expect(toCreateTaskInput('Buy milk', { notes: '2L', due: '2026-11-20', list: '日常タスク', parent: 'p1', after: 's1' })._unsafeUnwrap()).toEqual({
      list: { kind: 'named', name: '日常タスク' },
      input: {
        title: 'Buy milk',
        notes: '2L',
        due: { kind: 'date', date: '2026-11-20' },
        placement: { kind: 'subtask', parentId: 'p1', position: { kind: 'after', previousId: 's1' } },
      },
    });
  });

  it('places a root task after a sibling', () => {
    expect(toCreateTaskInput('x', { after: 's1' })._unsafeUnwrap().input.placement).toEqual({ kind: 'root', position: { kind: 'after', previousId: 's1' } });
  });

  it('rejects a malformed --due', () => {
    expect(toCreateTaskInput('x', { due: '2026-11-20T10:00:00+09:00' })._unsafeUnwrapErr().message).toContain('--due');
  });
});

describe('toUpdateTaskInput', () => {
  it('maps set / clear / keep flags', () => {
    expect(toUpdateTaskInput('t1', { title: 'New', clearNotes: true, due: '2026-11-21' })._unsafeUnwrap()).toEqual({
      list: { kind: 'default' },
      input: { taskId: 't1', title: { kind: 'set', value: 'New' }, notes: { kind: 'clear' }, due: { kind: 'set', value: '2026-11-21' } },
    });
  });

  it('clears the due date', () => {
    expect(toUpdateTaskInput('t1', { clearDue: true, list: 'MDE' })._unsafeUnwrap()).toMatchObject({ list: { kind: 'named', name: 'MDE' }, input: { due: { kind: 'clear' } } });
  });

  it('rejects --due with --clear-due', () => {
    expect(toUpdateTaskInput('t1', { due: '2026-11-21', clearDue: true })._unsafeUnwrapErr().message).toContain('--clear-due');
  });

  it('rejects a malformed --due', () => {
    expect(toUpdateTaskInput('t1', { due: 'friday' })._unsafeUnwrapErr().message).toContain('--due "friday"');
  });

  it('rejects an update that changes nothing, pointing at complete / reopen', () => {
    const error = toUpdateTaskInput('t1', {})._unsafeUnwrapErr();
    expect(error.message).toContain('--title');
    expect(error.message).toContain('gct tasks complete');
  });
});

describe('toTaskRef', () => {
  it('targets the default list unless --list is given', () => {
    expect(toTaskRef('t1', {})).toEqual({ list: { kind: 'default' }, input: { taskId: 't1' } });
    expect(toTaskRef('t1', { list: '@default' })).toEqual({ list: { kind: 'default' }, input: { taskId: 't1' } });
  });

  it('keeps a --list title or id unresolved', () => {
    expect(toTaskRef('t1', { list: 'vrc タスク' })).toEqual({ list: { kind: 'named', name: 'vrc タスク' }, input: { taskId: 't1' } });
  });
});
