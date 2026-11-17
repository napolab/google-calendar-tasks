import { GoogleNotFoundError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeServices } from '../../test-support';

import { runAddTask, runCompleteTask, runDeleteTask, runListTasks, runReopenTask, runUpdateTask } from './index';

import type { CompletedTask, CreateTaskInput, ListTasksInput, OpenTask, TaskRef, UpdateTaskInput } from '@napolab/gct-core/tasks';

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
};

const DONE: CompletedTask = { ...OPEN, status: 'completed', completedAt: '2026-11-17T03:00:00.000Z' };

describe('runListTasks', () => {
  it('lists with the CLI defaults', async () => {
    const calls: ListTasksInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTasks: (input) => (calls.push(input), okAsync({ items: [OPEN], next: { kind: 'last' } })) } }) });
    await runListTasks(ctx, { completed: 'include', max: 100 }, []);
    expect(calls).toEqual([{ due: { kind: 'any' }, completed: 'include', page: { kind: 'first' }, maxResults: 100 }]);
    expect(ctx.output.stdout).toEqual(['[ ] Buy milk  [t1]']);
  });

  it('tells a logged-out user to run gct login', async () => {
    const ctx = fakeContext();
    await runListTasks(ctx, { completed: 'include', max: 100 }, []);
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
    expect(ctx.output.stdout).toEqual(['Updated: [ ] Buy milk  [t1]']);
  });
});

describe('runCompleteTask / runReopenTask / runDeleteTask', () => {
  it('completes a task', async () => {
    const refs: TaskRef[] = [];
    const ctx = fakeContext({ services: fakeServices({ tasks: { completeTask: (ref) => (refs.push(ref), okAsync(DONE)) } }) });
    await runCompleteTask(ctx, { taskId: 't1', list: 'MDE' }, []);
    expect(refs).toEqual([{ taskListId: 'MDE', taskId: 't1' }]);
    expect(ctx.output.stdout).toEqual(['Completed: [x] Buy milk  [t1]']);
  });

  it('reopens a task', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { reopenTask: () => okAsync(OPEN) } }) });
    await runReopenTask(ctx, { taskId: 't1' }, []);
    expect(ctx.output.stdout).toEqual(['Reopened: [ ] Buy milk  [t1]']);
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
