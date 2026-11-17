import { GoogleNotFoundError, GoogleRateLimitError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeServices } from '../../../test-support';

import { listTasksInAllLists } from './index';

import type { ListTasksOptions } from '../input';
import type { ListTasksInput, OpenTask, TaskListSummary } from '@napolab/gct-core/tasks';

const LISTS: readonly TaskListSummary[] = [
  { id: 'MDE', title: 'マイタスク', updated: '2026-11-17T01:00:00.000Z' },
  { id: 'MDI', title: '日常タスク', updated: '2026-11-16T01:00:00.000Z' },
];

const OPTIONS: ListTasksOptions = {
  due: { kind: 'from', dueMin: '2026-11-17' },
  completed: 'exclude',
  completedAt: { kind: 'any' },
  updated: { kind: 'any' },
  deleted: 'exclude',
  assigned: 'exclude',
  maxResults: 3,
};

const taskIn = (taskListId: string): OpenTask => ({
  status: 'needsAction',
  id: `t-${taskListId}`,
  taskListId,
  title: 'Buy milk',
  notes: '',
  due: { kind: 'none' },
  hierarchy: { kind: 'root' },
  position: '00000000000000000001',
  updated: '2026-11-17T01:00:00.000Z',
  webViewLink: 'https://tasks.google.com/task/t1',
  links: [],
  assignment: { kind: 'none' },
  deleted: false,
  hidden: false,
});

describe('listTasksInAllLists', () => {
  it('reads the first page of every list with the same filters, in list order', async () => {
    const calls: ListTasksInput[] = [];
    const tasks = fakeServices({
      tasks: {
        listTaskLists: () => okAsync(LISTS),
        listTasks: (input) => {
          calls.push(input);
          const id = input.taskListId ?? '';
          return okAsync({ items: id === 'MDE' ? [] : [taskIn(id)], next: id === 'MDE' ? { kind: 'last' } : { kind: 'more', pageToken: 'tok' } });
        },
      },
    }).tasks;

    const result = await listTasksInAllLists(tasks, OPTIONS);

    expect(calls).toEqual([
      { ...OPTIONS, taskListId: 'MDE', page: { kind: 'first' } },
      { ...OPTIONS, taskListId: 'MDI', page: { kind: 'first' } },
    ]);
    expect(result._unsafeUnwrap()).toEqual([
      { taskList: LISTS[0], tasks: [], nextPage: { kind: 'last' } },
      { taskList: LISTS[1], tasks: [taskIn('MDI')], nextPage: { kind: 'more', pageToken: 'tok' } },
    ]);
  });

  it('returns no groups when there are no task lists', async () => {
    const tasks = fakeServices({ tasks: { listTaskLists: () => okAsync([]) } }).tasks;
    expect((await listTasksInAllLists(tasks, OPTIONS))._unsafeUnwrap()).toEqual([]);
  });

  it('fails with the Google error of a list', async () => {
    const tasks = fakeServices({
      tasks: {
        listTaskLists: () => okAsync(LISTS),
        listTasks: (input) => (input.taskListId === 'MDI' ? errAsync(new GoogleRateLimitError('slow down')) : okAsync({ items: [], next: { kind: 'last' } })),
      },
    }).tasks;
    expect((await listTasksInAllLists(tasks, OPTIONS))._unsafeUnwrapErr()).toBeInstanceOf(GoogleRateLimitError);
  });

  it('fails with the Google error of the list lookup', async () => {
    const tasks = fakeServices({ tasks: { listTaskLists: () => errAsync(new GoogleNotFoundError('gone')) } }).tasks;
    expect((await listTasksInAllLists(tasks, OPTIONS))._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});
