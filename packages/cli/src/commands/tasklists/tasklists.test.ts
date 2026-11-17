import { GoogleNotFoundError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeServices, knownTaskLists } from '../../test-support';

import { formatTaskLists, runAddTaskList, runDeleteTaskList, runRenameTaskList, runTaskLists } from './index';

import type { CreateTaskListInput, RenameTaskListInput, TaskListRef, TaskListSummary } from '@napolab/gct-core/tasks';

const LISTS: readonly TaskListSummary[] = [
  { id: 'MDE', title: 'My Tasks', updated: '2026-11-17T01:00:00.000Z' },
  { id: 'MDI', title: '', updated: '2026-11-16T01:00:00.000Z' },
];

describe('formatTaskLists', () => {
  it('shows title and id per list', () => {
    expect(formatTaskLists(LISTS)).toBe('My Tasks  [MDE]\n(no title)  [MDI]');
  });

  it('says when there are none', () => {
    expect(formatTaskLists([])).toBe('No task lists.');
  });
});

describe('runTaskLists', () => {
  it('lists task lists', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists: () => okAsync(LISTS) } }) });
    await runTaskLists(ctx, {}, []);
    expect(ctx.output.stdout).toEqual(['My Tasks  [MDE]\n(no title)  [MDI]']);
  });

  it('prints JSON', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists: () => okAsync(LISTS) } }) });
    await runTaskLists(ctx, { json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual(LISTS);
  });
});

const lookups = knownTaskLists(LISTS);

const WORK: TaskListSummary = { id: 'L9', title: 'Work', updated: '2026-11-17T02:00:00.000Z' };

describe('runAddTaskList', () => {
  it('creates the list and prints it', async () => {
    const calls: CreateTaskListInput[] = [];
    const createTaskList = (input: CreateTaskListInput) => (calls.push(input), okAsync(WORK));
    const ctx = fakeContext({ services: fakeServices({ tasks: { createTaskList } }) });
    await runAddTaskList(ctx, { title: 'Work' }, []);
    expect(calls).toEqual([{ title: 'Work' }]);
    expect(ctx.output.stdout).toEqual(['Added: Work  [L9]']);
  });

  it('prints the new list as JSON', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { createTaskList: () => okAsync(WORK) } }) });
    await runAddTaskList(ctx, { title: 'Work', json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual(WORK);
  });

  it('rejects a blank title before logging in or calling Google', async () => {
    // Not logged in: an input error must win over NotLoggedInError.
    const ctx = fakeContext();
    await runAddTaskList(ctx, { title: '  ' }, []);
    expect(ctx.output.stderr[0]).toMatch(/^InvalidInputError: .*task list title/);
    expect(ctx.output.failed()).toBe(true);
  });

  it('rejects extra arguments (an unquoted title)', async () => {
    const ctx = fakeContext();
    await runAddTaskList(ctx, { title: 'Work' }, ['stuff']);
    expect(ctx.output.stderr[0]).toContain('"stuff"');
  });
});

describe('runRenameTaskList', () => {
  it('resolves the list by title and renames it', async () => {
    const calls: RenameTaskListInput[] = [];
    const renameTaskList = (input: RenameTaskListInput) => (calls.push(input), okAsync({ id: 'MDE', title: 'Office', updated: '2026-11-17T03:00:00.000Z' }));
    const ctx = fakeContext({ services: fakeServices({ tasks: { ...lookups, renameTaskList } }) });
    await runRenameTaskList(ctx, { list: 'My Tasks', title: 'Office' }, []);
    expect(calls).toEqual([{ taskListId: 'MDE', title: 'Office' }]);
    expect(ctx.output.stdout).toEqual(['Renamed: Office  [MDE]']);
  });

  it('renames @default without looking up the lists', async () => {
    const calls: RenameTaskListInput[] = [];
    const renameTaskList = (input: RenameTaskListInput) => (calls.push(input), okAsync(WORK));
    // Neither getTaskList nor listTaskLists is overridden: a lookup would fail the run.
    const ctx = fakeContext({ services: fakeServices({ tasks: { renameTaskList } }) });
    await runRenameTaskList(ctx, { list: '@default', title: 'Work', json: true }, []);
    expect(calls).toEqual([{ taskListId: '@default', title: 'Work' }]);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual(WORK);
  });

  it('rejects a blank new title before looking up the list', async () => {
    const ctx = fakeContext();
    await runRenameTaskList(ctx, { list: 'My Tasks', title: ' ' }, []);
    expect(ctx.output.stderr[0]).toMatch(/^InvalidInputError: /);
  });

  it('reports an unknown list with every title', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { ...lookups } }) });
    await runRenameTaskList(ctx, { list: 'nope', title: 'x' }, []);
    expect(ctx.output.stderr[0]).toContain('TaskListNotFoundError');
    expect(ctx.output.stderr[0]).toContain('"My Tasks"');
  });
});

describe('runDeleteTaskList', () => {
  it('resolves the list, deletes it by id and says which list was deleted', async () => {
    const calls: TaskListRef[] = [];
    const deleteTaskList = (input: TaskListRef) => (calls.push(input), okAsync(undefined));
    const ctx = fakeContext({ services: fakeServices({ tasks: { ...lookups, deleteTaskList } }) });
    await runDeleteTaskList(ctx, { list: 'my tasks' }, []);
    expect(calls).toEqual([{ taskListId: 'MDE' }]);
    expect(ctx.output.stdout).toEqual(['Deleted task list My Tasks  [MDE].']);
  });

  it('prints the deleted list as JSON', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { ...lookups, deleteTaskList: () => okAsync(undefined) } }) });
    await runDeleteTaskList(ctx, { list: 'MDE', json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual({ kind: 'deleted', taskList: LISTS[0] });
  });

  it('rejects @default before logging in or calling Google', async () => {
    const ctx = fakeContext();
    await runDeleteTaskList(ctx, { list: '@default' }, []);
    expect(ctx.output.stderr[0]).toMatch(/^InvalidInputError: .*default task list cannot be deleted/);
    expect(ctx.output.failed()).toBe(true);
  });

  it.each(['', '  '])('rejects the blank list %j instead of matching an untitled list', async (list) => {
    // LISTS has an untitled list (MDI), which a blank title query would otherwise match.
    const ctx = fakeContext({ services: fakeServices({ tasks: { ...lookups } }) });
    await runDeleteTaskList(ctx, { list }, []);
    expect(ctx.output.stderr[0]).toMatch(/^InvalidInputError: /);
    expect(ctx.output.stdout).toEqual([]);
  });

  it('does not delete when the list is not found', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { ...lookups } }) });
    await runDeleteTaskList(ctx, { list: 'nope' }, []);
    expect(ctx.output.stderr[0]).toContain('TaskListNotFoundError');
  });

  it('reports a Google failure of the delete', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { ...lookups, deleteTaskList: () => errAsync(new GoogleNotFoundError('gone')) } }) });
    await runDeleteTaskList(ctx, { list: 'MDE' }, []);
    expect(ctx.output.stderr[0]).toBe('GoogleNotFoundError: gone');
    expect(ctx.output.stdout).toEqual([]);
  });
});
