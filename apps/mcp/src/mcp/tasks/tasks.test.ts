import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { GoogleReconnectRequiredError } from '../../errors';
import { createTasksToolHandlers } from './index';

import type { ToolDeps } from '../tool-deps';
import type { ICalendarService } from '@napolab/gct-core/calendar';
import type { ITasksService, Task, TaskListSummary } from '@napolab/gct-core/tasks';

const CONNECT_URL = 'https://gct.example.com/google/connect';

const LISTS: TaskListSummary[] = [
  { id: 'l-default', title: 'My Tasks', updated: 'u' },
  { id: 'l-work', title: 'Work', updated: 'u' },
];

const task = (taskListId: string, id = 't1'): Task => ({
  status: 'needsAction',
  id,
  taskListId,
  title: 'Task',
  notes: '',
  due: { kind: 'none' },
  hierarchy: { kind: 'root' },
  position: '0',
  updated: 'u',
  webViewLink: '',
});

const unexpected = () => {
  throw new Error('unexpected call');
};

const calendar: ICalendarService = {
  listCalendars: unexpected,
  listEvents: unexpected,
  getEvent: unexpected,
  createEvent: unexpected,
  updateEvent: unexpected,
  deleteEvent: unexpected,
  queryFreeBusy: unexpected,
};

const handlersWith = (overrides: Partial<ITasksService>) => {
  const calls: { method: string; input: unknown }[] = [];
  const record =
    <I, R>(method: string, respond: (input: I) => R) =>
    (input: I): R => {
      calls.push({ method, input });
      return respond(input);
    };
  const tasks: ITasksService = {
    listTaskLists: () => okAsync(LISTS),
    listTasks: record('listTasks', (input: { taskListId?: string }) => okAsync({ items: [task(input.taskListId ?? '@default')], next: { kind: 'last' } as const })),
    getTask: unexpected,
    createTask: record('createTask', (input: { taskListId?: string }) => okAsync(task(input.taskListId ?? '@default'))),
    updateTask: record('updateTask', (input: { taskListId?: string }) => okAsync(task(input.taskListId ?? '@default'))),
    completeTask: record('completeTask', (input: { taskListId?: string }) => okAsync({ ...task(input.taskListId ?? '@default'), status: 'completed' as const, completedAt: 'c' })),
    reopenTask: record('reopenTask', (input: { taskListId?: string }) => okAsync(task(input.taskListId ?? '@default'))),
    deleteTask: record('deleteTask', () => okAsync(undefined)),
    getTaskList: unexpected,
    createTaskList: record('createTaskList', (input: { title: string }) => okAsync({ id: 'l-new', title: input.title, updated: 'u' })),
    renameTaskList: record('renameTaskList', (input: { taskListId: string; title: string }) => okAsync({ id: input.taskListId, title: input.title, updated: 'u' })),
    deleteTaskList: record('deleteTaskList', () => okAsync(undefined)),
    ...overrides,
  };
  const deps: ToolDeps = { services: { calendar, tasks }, now: () => 0, connectURL: CONNECT_URL };
  return { handlers: createTasksToolHandlers(deps), calls };
};

const jsonOf = (result: { content: { text: string }[]; isError?: boolean }): unknown => {
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? '');
};

const errorTextOf = (result: { content: { text: string }[]; isError?: boolean }): string => {
  expect(result.isError).toBe(true);
  return result.content[0]?.text ?? '';
};

describe('tasks tools', () => {
  it('list_task_lists returns the lists with their ids', async () => {
    const { handlers } = handlersWith({});

    expect(jsonOf(await handlers.listTaskLists())).toEqual({ taskLists: LISTS });
  });

  it('list_tasks without list reads every list and groups the tasks by list', async () => {
    const { handlers, calls } = handlersWith({});

    const body = jsonOf(await handlers.listTasks({}));

    expect(body).toMatchObject({
      lists: [
        { taskListId: 'l-default', title: 'My Tasks', tasks: [{ id: 't1', taskListId: 'l-default' }], nextPageToken: null },
        { taskListId: 'l-work', title: 'Work', tasks: [{ id: 't1', taskListId: 'l-work' }], nextPageToken: null },
      ],
    });
    expect(calls.map((call) => call.input)).toEqual([
      { due: { kind: 'any' }, completed: 'include', maxResults: 100, taskListId: 'l-default', page: { kind: 'first' } },
      { due: { kind: 'any' }, completed: 'include', maxResults: 100, taskListId: 'l-work', page: { kind: 'first' } },
    ]);
  });

  it('list_tasks resolves a list title (case-insensitive) to its id', async () => {
    const { handlers, calls } = handlersWith({});

    expect(jsonOf(await handlers.listTasks({ list: 'work' }))).toMatchObject({ taskListId: 'l-work', nextPageToken: null });
    expect(calls[0]?.input).toMatchObject({ taskListId: 'l-work' });
  });

  it('names the available lists when the list does not exist', async () => {
    const { handlers, calls } = handlersWith({});

    const text = errorTextOf(await handlers.createTask({ title: 'x', list: 'Shopping' }));

    expect(text).toContain('Shopping');
    expect(text).toContain('"Work"');
    expect(calls).toEqual([]);
  });

  it('uses @default without a lookup', async () => {
    const { handlers, calls } = handlersWith({ listTaskLists: unexpected });

    expect(jsonOf(await handlers.createTask({ title: 'Buy milk' }))).toMatchObject({ taskListId: '@default' });
    expect(calls).toEqual([{ method: 'createTask', input: { title: 'Buy milk', notes: '', due: { kind: 'none' }, placement: { kind: 'root', position: { kind: 'first' } }, taskListId: '@default' } }]);
  });

  it('update / complete / reopen / delete address the resolved list', async () => {
    const { handlers, calls } = handlersWith({});

    jsonOf(await handlers.updateTask({ taskId: 't1', list: 'Work', title: 'New' }));
    expect(jsonOf(await handlers.completeTask({ taskId: 't1', list: 'l-work' }))).toMatchObject({ status: 'completed', completedAt: 'c' });
    jsonOf(await handlers.reopenTask({ taskId: 't1' }));
    expect(jsonOf(await handlers.deleteTask({ taskId: 't1', list: 'Work' }))).toEqual({ deleted: true, taskListId: 'l-work', taskId: 't1' });

    expect(calls.map((call) => [call.method, call.input])).toEqual([
      ['updateTask', { taskId: 't1', title: { kind: 'set', value: 'New' }, notes: { kind: 'keep' }, due: { kind: 'keep' }, taskListId: 'l-work' }],
      ['completeTask', { taskId: 't1', taskListId: 'l-work' }],
      ['reopenTask', { taskId: 't1', taskListId: '@default' }],
      ['deleteTask', { taskId: 't1', taskListId: 'l-work' }],
    ]);
  });

  it('rejects invalid arguments before any Google call', async () => {
    const { handlers, calls } = handlersWith({ listTaskLists: unexpected });

    expect(errorTextOf(await handlers.updateTask({ taskId: 't1' }))).toContain('Nothing to update');
    expect(calls).toEqual([]);
  });

  it('asks for a reconnect when the authorization expired', async () => {
    const { handlers } = handlersWith({ listTaskLists: () => errAsync(new GoogleReconnectRequiredError('expired')) });

    expect(errorTextOf(await handlers.listTaskLists())).toContain(CONNECT_URL);
  });

  it('create_task_list creates the list and returns it with its id', async () => {
    const { handlers, calls } = handlersWith({});

    expect(jsonOf(await handlers.createTaskList({ title: 'Errands' }))).toEqual({ id: 'l-new', title: 'Errands', updated: 'u' });
    expect(calls).toEqual([{ method: 'createTaskList', input: { title: 'Errands' } }]);
  });

  it('rename_task_list resolves the list title to its id, and passes @default through without a lookup', async () => {
    const { handlers, calls } = handlersWith({});

    expect(jsonOf(await handlers.renameTaskList({ list: 'work', title: 'Office' }))).toEqual({ id: 'l-work', title: 'Office', updated: 'u' });
    await handlers.renameTaskList({ list: '@default', title: 'Inbox' });

    expect(calls).toEqual([
      { method: 'renameTaskList', input: { taskListId: 'l-work', title: 'Office' } },
      { method: 'renameTaskList', input: { taskListId: '@default', title: 'Inbox' } },
    ]);
  });

  it('delete_task_list resolves the list and returns which list was deleted', async () => {
    const { handlers, calls } = handlersWith({});

    expect(jsonOf(await handlers.deleteTaskList({ list: 'Work' }))).toEqual({ deleted: true, taskList: { id: 'l-work', title: 'Work', updated: 'u' } });
    expect(calls).toEqual([{ method: 'deleteTaskList', input: { taskListId: 'l-work' } }]);
  });

  it('delete_task_list names the available lists when the list does not exist, and deletes nothing', async () => {
    const { handlers, calls } = handlersWith({});

    const text = errorTextOf(await handlers.deleteTaskList({ list: 'nope' }));

    expect(text).toContain('"My Tasks", "Work"');
    expect(calls).toEqual([]);
  });

  it('rejects a blank title and deleting @default before any Google call', async () => {
    const { handlers, calls } = handlersWith({ listTaskLists: unexpected });

    expect(errorTextOf(await handlers.createTaskList({ title: ' ' }))).toContain('task list title');
    expect(errorTextOf(await handlers.renameTaskList({ list: 'Work', title: '' }))).toContain('task list title');
    expect(errorTextOf(await handlers.deleteTaskList({ list: '@default' }))).toContain('default task list cannot be deleted');
    // A blank list would otherwise title-match an untitled list.
    expect(errorTextOf(await handlers.deleteTaskList({ list: ' ' }))).toContain('id or title');
    expect(calls).toEqual([]);
  });
});
