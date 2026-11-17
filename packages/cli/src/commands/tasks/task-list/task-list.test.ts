import { AmbiguousTaskListError, GoogleAPIError, GoogleNetworkError, TaskListNotFoundError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeServices } from '../../../test-support';

import { resolveListTarget, resolveNamedTaskList, resolveTargeted } from './index';

import type { TaskListSummary } from '@napolab/gct-core/tasks';

const LISTS: readonly TaskListSummary[] = [
  { id: 'MDE', title: 'マイタスク', updated: '2026-11-17T01:00:00.000Z' },
  { id: 'MDI', title: '日常タスク', updated: '2026-11-16T01:00:00.000Z' },
];

// A fake Google Tasks that knows LISTS: GET by id answers only real ids (400 "Invalid task list ID" otherwise, as
// Google does for a title). Records every lookup call.
const withListsOf = (lists: readonly TaskListSummary[]) => {
  const calls: string[] = [];
  const tasks = fakeServices({
    tasks: {
      getTaskList: ({ taskListId }) => {
        calls.push(`getTaskList ${taskListId}`);
        const list = lists.find((candidate) => candidate.id === taskListId);
        return list === undefined ? errAsync(new GoogleAPIError('Google API 400: Invalid task list ID', 400)) : okAsync(list);
      },
      listTaskLists: () => {
        calls.push('listTaskLists');
        return okAsync(lists);
      },
    },
  }).tasks;
  return { tasks, calls };
};

const withLists = () => withListsOf(LISTS).tasks;

describe('resolveListTarget', () => {
  it('passes the default list through as @default without looking up the lists', async () => {
    // The fake fails listTaskLists, so a lookup would turn this into an error.
    const tasks = fakeServices({}).tasks;
    expect((await resolveListTarget(tasks, { kind: 'default' }))._unsafeUnwrap()).toBe('@default');
  });

  it('resolves a title to its list id, falling back to listing every list when it is not an id', async () => {
    const { tasks, calls } = withListsOf(LISTS);
    expect((await resolveListTarget(tasks, { kind: 'named', name: '日常タスク' }))._unsafeUnwrap()).toBe('MDI');
    expect(calls).toEqual(['getTaskList 日常タスク', 'listTaskLists']);
  });

  it('resolves an id with exactly one lookup by id (no listing)', async () => {
    const { tasks, calls } = withListsOf(LISTS);
    expect((await resolveListTarget(tasks, { kind: 'named', name: 'MDE' }))._unsafeUnwrap()).toBe('MDE');
    expect(calls).toEqual(['getTaskList MDE']);
  });

  it('fails with TaskListNotFoundError listing the titles', async () => {
    const error = (await resolveListTarget(withLists(), { kind: 'named', name: 'nope' }))._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(TaskListNotFoundError);
    expect(error.message).toContain('"マイタスク", "日常タスク"');
  });

  it('fails with AmbiguousTaskListError when titles collide', async () => {
    const { tasks } = withListsOf([...LISTS, { id: 'MDX', title: '日常タスク', updated: '2026-11-15T01:00:00.000Z' }]);
    expect((await resolveListTarget(tasks, { kind: 'named', name: '日常タスク' }))._unsafeUnwrapErr()).toBeInstanceOf(AmbiguousTaskListError);
  });

  it('propagates the Google error of the lookup', async () => {
    const tasks = fakeServices({ tasks: { getTaskList: () => errAsync(new GoogleNetworkError('offline')) } }).tasks;
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
