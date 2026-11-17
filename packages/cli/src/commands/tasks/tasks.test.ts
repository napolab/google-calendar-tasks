import { GoogleNotFoundError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeServices } from '../../test-support';

import { runAddTask, runCompleteTask, runDeleteTask, runListTasks, runReopenTask, runUpdateTask } from './index';

import type { CompletedTask, CreateTaskInput, ListTasksInput, OpenTask, TaskListSummary, TaskRef, UpdateTaskInput } from '@napolab/gct-core/tasks';

const OPEN: OpenTask = {
  status: 'needsAction',
  id: 't1',
  taskListId: '@default',
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
};

const DONE: CompletedTask = { ...OPEN, status: 'completed', completedAt: '2026-11-17T03:00:00.000Z' };

const LISTS: readonly TaskListSummary[] = [
  { id: 'MDE', title: 'マイタスク', updated: '2026-11-17T01:00:00.000Z' },
  { id: 'MDI', title: '日常タスク', updated: '2026-11-16T01:00:00.000Z' },
];

const listTaskLists = () => okAsync(LISTS);

const DEFAULTS = { completed: 'include', max: 100 } as const;

describe('runListTasks', () => {
  it('lists every task list by default, grouped by list title', async () => {
    const calls: ListTasksInput[] = [];
    const listTasks = (input: ListTasksInput) => (calls.push(input), okAsync({ items: input.taskListId === 'MDI' ? [OPEN] : [], next: { kind: 'last' } as const }));
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists, listTasks } }) });
    await runListTasks(ctx, DEFAULTS, []);
    expect(calls).toEqual([
      {
        taskListId: 'MDE',
        due: { kind: 'any' },
        completed: 'include',
        completedAt: { kind: 'any' },
        updated: { kind: 'any' },
        deleted: 'exclude',
        assigned: 'exclude',
        page: { kind: 'first' },
        maxResults: 100,
      },
      {
        taskListId: 'MDI',
        due: { kind: 'any' },
        completed: 'include',
        completedAt: { kind: 'any' },
        updated: { kind: 'any' },
        deleted: 'exclude',
        assigned: 'exclude',
        page: { kind: 'first' },
        maxResults: 100,
      },
    ]);
    expect(ctx.output.stdout).toEqual(['# 日常タスク\n[ ] Buy milk  [t1]']);
  });

  it('prints every list as JSON, empty ones included', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists, listTasks: (input) => okAsync({ items: input.taskListId === 'MDI' ? [OPEN] : [], next: { kind: 'last' } }) } }) });
    await runListTasks(ctx, { ...DEFAULTS, json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual([
      { taskList: LISTS[0], tasks: [], nextPage: { kind: 'last' } },
      { taskList: LISTS[1], tasks: [OPEN], nextPage: { kind: 'last' } },
    ]);
  });

  it('says No tasks. when there is no task list', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists: () => okAsync([]) } }) });
    await runListTasks(ctx, DEFAULTS, []);
    expect(ctx.output.stdout).toEqual(['No tasks.']);
  });

  it('lists one list named by its title', async () => {
    const calls: ListTasksInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists, listTasks: (input) => (calls.push(input), okAsync({ items: [OPEN], next: { kind: 'more', pageToken: 'tok' } })) } }) });
    await runListTasks(ctx, { ...DEFAULTS, list: '日常タスク', pageToken: 'p2' }, []);
    expect(calls).toEqual([
      {
        taskListId: 'MDI',
        due: { kind: 'any' },
        completed: 'include',
        completedAt: { kind: 'any' },
        updated: { kind: 'any' },
        deleted: 'exclude',
        assigned: 'exclude',
        page: { kind: 'token', pageToken: 'p2' },
        maxResults: 100,
      },
    ]);
    expect(ctx.output.stdout).toEqual(['[ ] Buy milk  [t1]\nMore tasks: --page-token tok']);
  });

  it('prints one list as the bare task page JSON', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists, listTasks: () => okAsync({ items: [OPEN], next: { kind: 'last' } }) } }) });
    await runListTasks(ctx, { ...DEFAULTS, list: 'MDE', json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual({ items: [OPEN], next: { kind: 'last' } });
  });

  it('lists the default list for --list @default without looking up the lists', async () => {
    const calls: ListTasksInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTasks: (input) => (calls.push(input), okAsync({ items: [OPEN], next: { kind: 'last' } })) } }) });
    await runListTasks(ctx, { ...DEFAULTS, list: '@default' }, []);
    expect(calls.map((input) => input.taskListId)).toEqual(['@default']);
    expect(ctx.output.stdout).toEqual(['[ ] Buy milk  [t1]']);
  });

  it('fails for an unknown --list, listing the titles and pointing at gct tasklists', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists } }) });
    await runListTasks(ctx, { ...DEFAULTS, list: 'nope' }, []);
    const stderr = ctx.output.stderr.join('\n');
    expect(stderr).toContain('TaskListNotFoundError');
    expect(stderr).toContain('"マイタスク", "日常タスク"');
    expect(stderr).toContain('gct tasklists');
    expect(ctx.output.failed()).toBe(true);
  });

  it('rejects --page-token without --list before signing in', async () => {
    const ctx = fakeContext();
    await runListTasks(ctx, { ...DEFAULTS, pageToken: 'tok' }, []);
    expect(ctx.output.stderr.join('\n')).toContain('InvalidInputError: --page-token "tok" needs --list');
    expect(ctx.output.failed()).toBe(true);
  });

  it('tells a logged-out user to run gct login', async () => {
    const ctx = fakeContext();
    await runListTasks(ctx, DEFAULTS, []);
    expect(ctx.output.stderr.join('\n')).toContain('gct login');
    expect(ctx.output.failed()).toBe(true);
  });
});

describe('runAddTask', () => {
  it('adds the task and prints it', async () => {
    const calls: CreateTaskInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { createTask: (input) => (calls.push(input), okAsync(OPEN)) } }) });
    await runAddTask(ctx, { title: 'Buy milk' }, []);
    expect(calls[0]?.title).toBe('Buy milk');
    expect(ctx.output.stdout).toEqual(['Added: [ ] Buy milk  [t1]']);
  });

  it('adds to a list named by its title', async () => {
    const calls: CreateTaskInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists, createTask: (input) => (calls.push(input), okAsync(OPEN)) } }) });
    await runAddTask(ctx, { title: 'Buy milk', list: '日常タスク' }, []);
    expect(calls[0]?.taskListId).toBe('MDI');
  });

  it('rejects an unquoted multi-word title instead of dropping words', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { createTask: () => okAsync(OPEN) } }) });
    await runAddTask(ctx, { title: 'Buy' }, ['milk']);
    expect(ctx.output.stderr.join('\n')).toContain('"milk"');
    expect(ctx.output.stdout).toEqual([]);
    expect(ctx.output.failed()).toBe(true);
  });
});

describe('runUpdateTask', () => {
  it('sends the patch', async () => {
    const calls: UpdateTaskInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { updateTask: (input) => (calls.push(input), okAsync(OPEN)) } }) });
    await runUpdateTask(ctx, { taskId: 't1', title: 'Buy milk' }, []);
    expect(calls[0]?.title).toEqual({ kind: 'set', value: 'Buy milk' });
    expect(calls[0]?.taskListId).toBe('@default');
    expect(ctx.output.stdout).toEqual(['Updated: [ ] Buy milk  [t1]']);
  });

  it('updates in a list named by its title', async () => {
    const calls: UpdateTaskInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists, updateTask: (input) => (calls.push(input), okAsync(OPEN)) } }) });
    await runUpdateTask(ctx, { taskId: 't1', title: 'Buy milk', list: 'マイタスク' }, []);
    expect(calls[0]?.taskListId).toBe('MDE');
  });
});

describe('runCompleteTask / runReopenTask / runDeleteTask', () => {
  it('completes a task in a list named by its title', async () => {
    const refs: TaskRef[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists, completeTask: (ref) => (refs.push(ref), okAsync(DONE)) } }) });
    await runCompleteTask(ctx, { taskId: 't1', list: '日常タスク' }, []);
    expect(refs).toEqual([{ taskListId: 'MDI', taskId: 't1' }]);
    expect(ctx.output.stdout).toEqual(['Completed: [x] Buy milk  [t1]']);
  });

  it('reopens a task', async () => {
    const refs: TaskRef[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists, reopenTask: (ref) => (refs.push(ref), okAsync(OPEN)) } }) });
    await runReopenTask(ctx, { taskId: 't1', list: 'MDE' }, []);
    expect(refs).toEqual([{ taskListId: 'MDE', taskId: 't1' }]);
    expect(ctx.output.stdout).toEqual(['Reopened: [ ] Buy milk  [t1]']);
  });

  it('deletes from a list named by its title and confirms with its id', async () => {
    const refs: TaskRef[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists, deleteTask: (ref) => (refs.push(ref), okAsync(undefined)) } }) });
    await runDeleteTask(ctx, { taskId: 't1', list: '日常タスク' }, []);
    expect(refs).toEqual([{ taskListId: 'MDI', taskId: 't1' }]);
    expect(ctx.output.stdout).toEqual(['Deleted task t1 from list MDI.']);
  });

  it('fails with the ambiguity and the candidate ids when titles collide', async () => {
    const twins = () => okAsync([...LISTS, { id: 'MDX', title: '日常タスク', updated: '2026-11-15T01:00:00.000Z' }]);
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists: twins } }) });
    await runCompleteTask(ctx, { taskId: 't1', list: '日常タスク' }, []);
    const stderr = ctx.output.stderr.join('\n');
    expect(stderr).toContain('AmbiguousTaskListError');
    expect(stderr).toContain('(id MDI)');
    expect(stderr).toContain('(id MDX)');
    expect(ctx.output.failed()).toBe(true);
  });

  it('deletes a task and confirms, also as JSON', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { deleteTask: () => okAsync(undefined) } }) });
    await runDeleteTask(ctx, { taskId: 't1' }, []);
    await runDeleteTask(ctx, { taskId: 't1', json: true }, []);
    expect(ctx.output.stdout[0]).toBe('Deleted task t1 from list @default.');
    expect(JSON.parse(ctx.output.stdout[1] ?? '')).toEqual({ kind: 'deleted', taskListId: '@default', taskId: 't1' });
  });

  it('fails with the Google error', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { completeTask: () => errAsync(new GoogleNotFoundError('Google API 404: Not Found')) } }) });
    await runCompleteTask(ctx, { taskId: 'nope' }, []);
    expect(ctx.output.stderr).toEqual(['GoogleNotFoundError: Google API 404: Not Found']);
  });
});
