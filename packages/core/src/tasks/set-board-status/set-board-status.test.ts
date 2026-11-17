import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { GoogleAPIError } from '../../errors';

import { setTaskBoardStatus } from './index';

import type { ITasksService, Task, TaskRef, UpdateTaskInput } from '../index';

const unexpected = () => {
  throw new Error('unexpected call');
};

const baseTask = {
  id: 'T1',
  taskListId: 'L1',
  title: 'Write report',
  due: { kind: 'none' },
  hierarchy: { kind: 'root' },
  position: '00000000000000000001',
  updated: '2026-11-17T00:00:00.000Z',
  webViewLink: '',
  links: [],
  assignment: { kind: 'none' },
  deleted: false,
  hidden: false,
} as const;

const open = (notes: string): Task => ({ ...baseTask, notes, status: 'needsAction' });
const completed = (notes: string): Task => ({ ...baseTask, notes, status: 'completed', completedAt: '2026-11-17T01:00:00.000Z' });

type Call = { readonly method: 'complete' | 'reopen'; readonly ref: TaskRef } | { readonly method: 'update'; readonly input: UpdateTaskInput };

// A fake service whose complete / reopen answer with `afterStatus` and whose update echoes the new notes.
const fakeTasks = (afterStatus: Task) => {
  const calls: Call[] = [];
  const service: ITasksService = {
    listTaskLists: unexpected,
    getTaskList: unexpected,
    createTaskList: unexpected,
    renameTaskList: unexpected,
    deleteTaskList: unexpected,
    listTasks: unexpected,
    getTask: unexpected,
    createTask: unexpected,
    deleteTask: unexpected,
    moveTask: unexpected,
    clearCompletedTasks: unexpected,
    completeTask: (ref) => {
      calls.push({ method: 'complete', ref });
      return okAsync(afterStatus);
    },
    reopenTask: (ref) => {
      calls.push({ method: 'reopen', ref });
      return okAsync(afterStatus);
    },
    updateTask: (input) => {
      calls.push({ method: 'update', input });
      const notes = input.notes.kind === 'set' ? input.notes.value : afterStatus.notes;
      return okAsync({ ...afterStatus, notes });
    },
  };
  return { service, calls };
};

const ref = { taskListId: 'L1', taskId: 'T1' };

describe('setTaskBoardStatus', () => {
  it('done: completes the task, then rewrites its tag to done', async () => {
    const { service, calls } = fakeTasks(completed('[status: doing]\nbody'));

    const result = await setTaskBoardStatus(service, ref, 'done');

    expect(calls).toEqual([
      { method: 'complete', ref },
      { method: 'update', input: { ...ref, title: { kind: 'keep' }, notes: { kind: 'set', value: '[status: done]\nbody' }, due: { kind: 'keep' } } },
    ]);
    expect(result._unsafeUnwrap()).toMatchObject({ status: 'completed', notes: '[status: done]\nbody' });
  });

  it('doing: reopens the task, then tags it doing (untagged notes keep their body)', async () => {
    const { service, calls } = fakeTasks(open('just notes'));

    const result = await setTaskBoardStatus(service, ref, 'doing');

    expect(calls.map((call) => call.method)).toEqual(['reopen', 'update']);
    expect(result._unsafeUnwrap()).toMatchObject({ status: 'needsAction', notes: '[status: doing]\njust notes' });
  });

  it('todo: reopens a completed task and rewrites its done tag', async () => {
    const { service, calls } = fakeTasks(open('[status: done]'));

    const result = await setTaskBoardStatus(service, ref, 'todo');

    expect(calls.map((call) => call.method)).toEqual(['reopen', 'update']);
    expect(result._unsafeUnwrap()).toMatchObject({ status: 'needsAction', notes: '[status: todo]' });
  });

  it('skips the notes update when the tag is already canonical', async () => {
    const { service, calls } = fakeTasks(open('[status: doing]\nbody'));

    const result = await setTaskBoardStatus(service, ref, 'doing');

    expect(calls.map((call) => call.method)).toEqual(['reopen']);
    expect(result._unsafeUnwrap()).toMatchObject({ notes: '[status: doing]\nbody' });
  });

  it('returns the status change error without touching the notes', async () => {
    const { service, calls } = fakeTasks(open(''));
    const failing: ITasksService = { ...service, completeTask: () => errAsync(new GoogleAPIError('boom', 500)) };

    const result = await setTaskBoardStatus(failing, ref, 'done');

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleAPIError);
    expect(calls).toEqual([]);
  });
});
