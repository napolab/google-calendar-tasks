import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { toCreateTaskInput, toListTasksInput, toTaskRef, toUpdateTaskInput } from './index';

describe('toListTasksInput', () => {
  it('maps the defaults to the default list, any due date, the first page', () => {
    expect(toListTasksInput({ completed: 'include', max: 100 })._unsafeUnwrap()).toEqual({ due: { kind: 'any' }, completed: 'include', page: { kind: 'first' }, maxResults: 100 });
  });

  it('maps --completed hidden to includeHidden', () => {
    expect(toListTasksInput({ completed: 'hidden', max: 100 })._unsafeUnwrap().completed).toBe('includeHidden');
  });

  it('maps the due range', () => {
    expect(toListTasksInput({ completed: 'include', max: 100, dueFrom: '2026-11-17' })._unsafeUnwrap().due).toEqual({ kind: 'from', dueMin: '2026-11-17' });
    expect(toListTasksInput({ completed: 'include', max: 100, dueTo: '2026-11-30' })._unsafeUnwrap().due).toEqual({ kind: 'until', dueMax: '2026-11-30' });
    expect(toListTasksInput({ completed: 'include', max: 100, dueFrom: '2026-11-17', dueTo: '2026-11-30' })._unsafeUnwrap().due).toEqual({
      kind: 'between',
      dueMin: '2026-11-17',
      dueMax: '2026-11-30',
    });
  });

  it('maps --list, --max and --page-token', () => {
    expect(toListTasksInput({ completed: 'exclude', max: 20, list: 'MDE', pageToken: 'tok' })._unsafeUnwrap()).toEqual({
      taskListId: 'MDE',
      due: { kind: 'any' },
      completed: 'exclude',
      page: { kind: 'token', pageToken: 'tok' },
      maxResults: 20,
    });
  });

  it('rejects a malformed due date, naming the flag', () => {
    const error = toListTasksInput({ completed: 'include', max: 100, dueFrom: '2026/11/17' })._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--due-from "2026/11/17"');
  });
});

describe('toCreateTaskInput', () => {
  it('creates a root task first in the default list without notes or due', () => {
    expect(toCreateTaskInput('Buy milk', {})._unsafeUnwrap()).toEqual({ title: 'Buy milk', notes: '', due: { kind: 'none' }, placement: { kind: 'root', position: { kind: 'first' } } });
  });

  it('maps notes, due, list and a subtask placed after a sibling', () => {
    expect(toCreateTaskInput('Buy milk', { notes: '2L', due: '2026-11-20', list: 'MDE', parent: 'p1', after: 's1' })._unsafeUnwrap()).toEqual({
      taskListId: 'MDE',
      title: 'Buy milk',
      notes: '2L',
      due: { kind: 'date', date: '2026-11-20' },
      placement: { kind: 'subtask', parentId: 'p1', position: { kind: 'after', previousId: 's1' } },
    });
  });

  it('places a root task after a sibling', () => {
    expect(toCreateTaskInput('x', { after: 's1' })._unsafeUnwrap().placement).toEqual({ kind: 'root', position: { kind: 'after', previousId: 's1' } });
  });

  it('rejects a malformed --due', () => {
    expect(toCreateTaskInput('x', { due: '2026-11-20T10:00:00+09:00' })._unsafeUnwrapErr().message).toContain('--due');
  });
});

describe('toUpdateTaskInput', () => {
  it('maps set / clear / keep flags', () => {
    expect(toUpdateTaskInput('t1', { title: 'New', clearNotes: true, due: '2026-11-21' })._unsafeUnwrap()).toEqual({
      taskId: 't1',
      title: { kind: 'set', value: 'New' },
      notes: { kind: 'clear' },
      due: { kind: 'set', value: '2026-11-21' },
    });
  });

  it('clears the due date', () => {
    expect(toUpdateTaskInput('t1', { clearDue: true, list: 'MDE' })._unsafeUnwrap()).toMatchObject({ taskListId: 'MDE', due: { kind: 'clear' } });
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
  it('omits the list unless given', () => {
    expect(toTaskRef('t1', {})).toEqual({ taskId: 't1' });
    expect(toTaskRef('t1', { list: 'MDE' })).toEqual({ taskListId: 'MDE', taskId: 't1' });
  });
});
