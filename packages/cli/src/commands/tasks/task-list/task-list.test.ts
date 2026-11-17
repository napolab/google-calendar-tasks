import { AmbiguousTaskListError, GoogleNetworkError, TaskListNotFoundError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeServices } from '../../../test-support';

import { resolveListTarget, resolveNamedTaskList, resolveTargeted } from './index';

import type { TaskListSummary } from '@napolab/gct-core/tasks';

const LISTS: readonly TaskListSummary[] = [
  { id: 'MDE', title: 'マイタスク', updated: '2026-11-17T01:00:00.000Z' },
  { id: 'MDI', title: '日常タスク', updated: '2026-11-16T01:00:00.000Z' },
];

const withLists = () => fakeServices({ tasks: { listTaskLists: () => okAsync(LISTS) } }).tasks;

describe('resolveListTarget', () => {
  it('passes the default list through as @default without looking up the lists', async () => {
    // The fake fails listTaskLists, so a lookup would turn this into an error.
    const tasks = fakeServices({}).tasks;
    expect((await resolveListTarget(tasks, { kind: 'default' }))._unsafeUnwrap()).toBe('@default');
  });

  it('resolves a title to its list id', async () => {
    expect((await resolveListTarget(withLists(), { kind: 'named', name: '日常タスク' }))._unsafeUnwrap()).toBe('MDI');
  });

  it('resolves an id to itself', async () => {
    expect((await resolveListTarget(withLists(), { kind: 'named', name: 'MDE' }))._unsafeUnwrap()).toBe('MDE');
  });

  it('fails with TaskListNotFoundError listing the titles', async () => {
    const error = (await resolveListTarget(withLists(), { kind: 'named', name: 'nope' }))._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(TaskListNotFoundError);
    expect(error.message).toContain('"マイタスク", "日常タスク"');
  });

  it('fails with AmbiguousTaskListError when titles collide', async () => {
    const tasks = fakeServices({ tasks: { listTaskLists: () => okAsync([...LISTS, { id: 'MDX', title: '日常タスク', updated: '2026-11-15T01:00:00.000Z' }]) } }).tasks;
    expect((await resolveListTarget(tasks, { kind: 'named', name: '日常タスク' }))._unsafeUnwrapErr()).toBeInstanceOf(AmbiguousTaskListError);
  });

  it('propagates the Google error of the lookup', async () => {
    const tasks = fakeServices({ tasks: { listTaskLists: () => errAsync(new GoogleNetworkError('offline')) } }).tasks;
    expect((await resolveListTarget(tasks, { kind: 'named', name: '日常タスク' }))._unsafeUnwrapErr()).toBeInstanceOf(GoogleNetworkError);
  });
});

describe('resolveTargeted', () => {
  it('puts the resolved list id into the core input', async () => {
    expect((await resolveTargeted(withLists(), { list: { kind: 'named', name: '日常タスク' }, input: { taskId: 't1' } }))._unsafeUnwrap()).toEqual({ taskListId: 'MDI', taskId: 't1' });
  });
});

describe('resolveNamedTaskList', () => {
  it('resolves a title to the whole list summary', async () => {
    expect((await resolveNamedTaskList(withLists(), '日常タスク'))._unsafeUnwrap()).toEqual(LISTS[1]);
  });

  it('fails with TaskListNotFoundError for an unknown name', async () => {
    expect((await resolveNamedTaskList(withLists(), 'nope'))._unsafeUnwrapErr()).toBeInstanceOf(TaskListNotFoundError);
  });
});
