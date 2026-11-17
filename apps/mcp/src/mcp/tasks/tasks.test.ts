import { GoogleAPIError, GooglePermissionError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { GoogleReconnectRequiredError } from '../../errors';
import { createTasksToolHandlers, registerTasksTools } from './index';

import type { ToolDeps } from '../tool-deps';
import type { ICalendarService } from '@napolab/gct-core/calendar';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { z } from 'zod';

import type { ITasksService, Task, TaskListSummary } from '@napolab/gct-core/tasks';

const CONNECT_URL = 'https://gct.example.com/google/connect';

const LISTS: TaskListSummary[] = [
  { id: 'l-default', title: 'My Tasks', updated: 'u' },
  { id: 'l-work', title: 'Work', updated: 'u' },
  { id: 'l-daily', title: '日常タスク', updated: 'u' },
];

// The server's configured default list (DEFAULT_TASK_LIST): used whenever a single-task tool is called without list.
const DEFAULT_TASK_LIST = '日常タスク';

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
  links: [],
  assignment: { kind: 'none' },
  deleted: false,
  hidden: false,
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
  listEventInstances: unexpected,
  moveEvent: unexpected,
  quickAddEvent: unexpected,
  importEvent: unexpected,
  getCalendar: unexpected,
  createCalendar: unexpected,
  updateCalendar: unexpected,
  deleteCalendar: unexpected,
  clearPrimaryCalendar: unexpected,
  getCalendarListEntry: unexpected,
  subscribeCalendar: unexpected,
  updateCalendarListEntry: unexpected,
  unsubscribeCalendar: unexpected,
  listCalendarAcl: unexpected,
  getCalendarAclRule: unexpected,
  insertCalendarAclRule: unexpected,
  updateCalendarAclRule: unexpected,
  deleteCalendarAclRule: unexpected,
  getColors: unexpected,
  listSettings: unexpected,
  getSetting: unexpected,
};

const handlersWith = (overrides: Partial<ITasksService>, defaultTaskList = DEFAULT_TASK_LIST) => {
  const calls: { method: string; input: unknown }[] = [];
  // Task list lookups (tasklists.get / tasklists.list), kept apart from the operations in `calls`.
  const lookups: string[] = [];
  const record =
    <I, R>(method: string, respond: (input: I) => R) =>
    (input: I): R => {
      calls.push({ method, input });
      return respond(input);
    };
  const tasks: ITasksService = {
    listTaskLists: () => {
      lookups.push('listTaskLists');
      return okAsync(LISTS);
    },
    // Like Google: '@default' and the real ids are found; anything else (a title) is an invalid id.
    getTaskList: (input: { taskListId: string }) => {
      lookups.push(`getTaskList ${input.taskListId}`);
      const list = LISTS.find((candidate) => candidate.id === (input.taskListId === '@default' ? 'l-default' : input.taskListId));
      return list === undefined ? errAsync(new GoogleAPIError('Google API 400: Invalid task list ID', 400)) : okAsync(list);
    },
    listTasks: record('listTasks', (input: { taskListId?: string }) => okAsync({ items: [task(input.taskListId ?? '@default')], next: { kind: 'last' } as const })),
    getTask: record('getTask', (input: { taskListId?: string; taskId: string }) => okAsync(task(input.taskListId ?? '@default', input.taskId))),
    createTask: record('createTask', (input: { taskListId?: string }) => okAsync(task(input.taskListId ?? '@default'))),
    updateTask: record('updateTask', (input: { taskListId?: string }) => okAsync(task(input.taskListId ?? '@default'))),
    completeTask: record('completeTask', (input: { taskListId?: string }) => okAsync({ ...task(input.taskListId ?? '@default'), status: 'completed' as const, completedAt: 'c' })),
    reopenTask: record('reopenTask', (input: { taskListId?: string }) => okAsync(task(input.taskListId ?? '@default'))),
    deleteTask: record('deleteTask', () => okAsync(undefined)),
    moveTask: record('moveTask', (input: { taskId: string; taskListId?: string; destination: { kind: string; taskListId?: string } }) =>
      okAsync(task(input.destination.taskListId ?? input.taskListId ?? '@default', input.taskId)),
    ),
    clearCompletedTasks: record('clearCompletedTasks', () => okAsync(undefined)),
    createTaskList: record('createTaskList', (input: { title: string }) => okAsync({ id: 'l-new', title: input.title, updated: 'u' })),
    renameTaskList: record('renameTaskList', (input: { taskListId: string; title: string }) => okAsync({ id: input.taskListId, title: input.title, updated: 'u' })),
    deleteTaskList: record('deleteTaskList', () => okAsync(undefined)),
    ...overrides,
  };
  const deps: ToolDeps = { services: { calendar, tasks }, now: () => 0, connectURL: CONNECT_URL, defaultTaskList };
  return { handlers: createTasksToolHandlers(deps), calls, lookups };
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

    expect(Object.keys(body as object)).toEqual(['lists']);
    expect(body).toMatchObject({
      lists: [
        { taskListId: 'l-default', title: 'My Tasks', tasks: [{ id: 't1', taskListId: 'l-default' }], nextPageToken: null },
        { taskListId: 'l-work', title: 'Work', tasks: [{ id: 't1', taskListId: 'l-work' }], nextPageToken: null },
        { taskListId: 'l-daily', title: '日常タスク', tasks: [{ id: 't1', taskListId: 'l-daily' }], nextPageToken: null },
      ],
    });
    expect(calls.map((call) => call.input)).toEqual([
      {
        due: { kind: 'any' },
        completed: 'include',
        completedAt: { kind: 'any' },
        updated: { kind: 'any' },
        deleted: 'exclude',
        assigned: 'exclude',
        maxResults: 100,
        taskListId: 'l-default',
        page: { kind: 'first' },
      },
      {
        due: { kind: 'any' },
        completed: 'include',
        completedAt: { kind: 'any' },
        updated: { kind: 'any' },
        deleted: 'exclude',
        assigned: 'exclude',
        maxResults: 100,
        taskListId: 'l-work',
        page: { kind: 'first' },
      },
      {
        due: { kind: 'any' },
        completed: 'include',
        completedAt: { kind: 'any' },
        updated: { kind: 'any' },
        deleted: 'exclude',
        assigned: 'exclude',
        maxResults: 100,
        taskListId: 'l-daily',
        page: { kind: 'first' },
      },
    ]);
  });

  it('list_tasks resolves a list title (case-insensitive) to its id, listing the lists only after the GET by id fails', async () => {
    const { handlers, calls, lookups } = handlersWith({});

    const body = jsonOf(await handlers.listTasks({ list: 'work' }));

    expect(Object.keys(body as object)).toEqual(['lists']);
    expect(body).toMatchObject({ lists: [{ taskListId: 'l-work', title: 'Work', tasks: [{ id: 't1', taskListId: 'l-work' }], nextPageToken: null }] });
    expect(calls[0]?.input).toMatchObject({ taskListId: 'l-work' });
    expect(lookups).toEqual(['getTaskList work', 'listTaskLists']);
  });

  it('list_tasks reads a list id with exactly one lookup (GET by id, no listing)', async () => {
    const { handlers, calls, lookups } = handlersWith({});

    expect(jsonOf(await handlers.listTasks({ list: 'l-work' }))).toMatchObject({ lists: [{ taskListId: 'l-work', title: 'Work' }] });
    expect(calls[0]?.input).toMatchObject({ taskListId: 'l-work' });
    expect(lookups).toEqual(['getTaskList l-work']);
  });

  it("list_tasks reads '@default' with one GET for its real id and title, keeping the page token", async () => {
    const { handlers, calls, lookups } = handlersWith({ listTaskLists: unexpected });

    const body = jsonOf(await handlers.listTasks({ list: '@default', pageToken: 'p2' }));

    expect(Object.keys(body as object)).toEqual(['lists']);
    expect(body).toMatchObject({ lists: [{ taskListId: 'l-default', title: 'My Tasks', tasks: [{ id: 't1' }], nextPageToken: null }] });
    expect(calls[0]?.input).toMatchObject({ taskListId: 'l-default', page: { kind: 'token', pageToken: 'p2' } });
    expect(lookups).toEqual(['getTaskList @default']);
  });

  it('list_tasks lists each parent before its subtasks, in every list', async () => {
    const child: Task = { ...task('l-work', 'child'), hierarchy: { kind: 'subtask', parentId: 'parent' }, position: '00000000000000000000' };
    const parent: Task = { ...task('l-work', 'parent'), position: '00000000000000000001' };
    const { handlers } = handlersWith({ listTasks: () => okAsync({ items: [child, parent], next: { kind: 'last' } }) });

    for (const args of [{}, { list: 'l-work' }]) {
      const body = jsonOf(await handlers.listTasks(args)) as { lists: { tasks: { id: string; parentId: string | null; depth: number }[] }[] };
      for (const list of body.lists) {
        expect(list.tasks.map((listed) => [listed.id, listed.parentId, listed.depth])).toEqual([
          ['parent', null, 0],
          ['child', 'parent', 1],
        ]);
      }
    }
  });

  it('propagates a lookup failure other than an invalid id without listing', async () => {
    const { handlers, lookups } = handlersWith({ getTaskList: () => errAsync(new GooglePermissionError('Google API 403: Forbidden')) });

    expect(errorTextOf(await handlers.getTask({ taskId: 't1', list: 'l-work' }))).toContain('403');
    expect(lookups).toEqual([]);
  });

  it('names the available lists when the list does not exist', async () => {
    const { handlers, calls } = handlersWith({});

    const text = errorTextOf(await handlers.createTask({ title: 'x', list: 'Shopping' }));

    expect(text).toContain('Shopping');
    expect(text).toContain('"Work"');
    expect(calls).toEqual([]);
  });

  it("passes an explicit '@default' through as Google's default list without a lookup", async () => {
    const { handlers, calls, lookups } = handlersWith({ listTaskLists: unexpected, getTaskList: unexpected });

    expect(jsonOf(await handlers.createTask({ title: 'Buy milk', list: '@default' }))).toMatchObject({ taskListId: '@default' });
    expect(calls).toEqual([{ method: 'createTask', input: { title: 'Buy milk', notes: '', due: { kind: 'none' }, placement: { kind: 'root', position: { kind: 'first' } }, taskListId: '@default' } }]);
    expect(lookups).toEqual([]);
  });

  it('uses the configured default list (a title) when list is omitted', async () => {
    const { handlers, calls, lookups } = handlersWith({});

    expect(jsonOf(await handlers.createTask({ title: 'Buy milk' }))).toMatchObject({ taskListId: 'l-daily' });
    expect(calls).toEqual([{ method: 'createTask', input: { title: 'Buy milk', notes: '', due: { kind: 'none' }, placement: { kind: 'root', position: { kind: 'first' } }, taskListId: 'l-daily' } }]);
    expect(lookups).toEqual(['getTaskList 日常タスク', 'listTaskLists']);
  });

  it('uses the configured default list (an id) with one GET when list is omitted', async () => {
    const { handlers, calls, lookups } = handlersWith({ listTaskLists: unexpected }, 'l-work');

    jsonOf(await handlers.getTask({ taskId: 't1' }));

    expect(calls).toEqual([{ method: 'getTask', input: { taskId: 't1', taskListId: 'l-work' } }]);
    expect(lookups).toEqual(['getTaskList l-work']);
  });

  it("uses Google's default list when the configured default list is '@default'", async () => {
    const { handlers, calls } = handlersWith({}, '@default');

    jsonOf(await handlers.completeTask({ taskId: 't1' }));

    expect(calls).toEqual([{ method: 'completeTask', input: { taskId: 't1', taskListId: 'l-default' } }]);
  });

  it('explains a configured default list that does not exist, and calls nothing', async () => {
    const { handlers, calls } = handlersWith({}, 'Daily');

    for (const result of [
      await handlers.createTask({ title: 'x' }),
      await handlers.getTask({ taskId: 't1' }),
      await handlers.setTaskStatus({ taskId: 't1', status: 'done' }),
      await handlers.moveTask({ taskId: 't1', previousId: 's1' }),
    ]) {
      const text = errorTextOf(result);
      expect(text).toContain('list was omitted');
      expect(text).toContain('"Daily"');
      expect(text).toContain('"Work"');
      expect(text).toContain('list_task_lists');
      expect(text).toContain("'@default'");
    }
    expect(calls).toEqual([]);
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
      ['reopenTask', { taskId: 't1', taskListId: 'l-daily' }],
      ['deleteTask', { taskId: 't1', taskListId: 'l-work' }],
    ]);
  });

  it('set_task_status doing reopens the task in the resolved list and tags its notes', async () => {
    const { handlers, calls } = handlersWith({
      reopenTask: (input) => {
        calls.push({ method: 'reopenTask', input });
        return okAsync({ ...task('l-work'), notes: 'call Bob' });
      },
      updateTask: (input) => {
        calls.push({ method: 'updateTask', input });
        return okAsync({ ...task('l-work'), notes: input.notes.kind === 'set' ? input.notes.value : '' });
      },
    });

    expect(jsonOf(await handlers.setTaskStatus({ taskId: 't1', list: 'Work', status: 'doing' }))).toMatchObject({
      boardStatus: 'doing',
      body: 'call Bob',
      notes: '[status: doing]\ncall Bob',
    });
    expect(calls.map((call) => [call.method, call.input])).toEqual([
      ['reopenTask', { taskId: 't1', taskListId: 'l-work' }],
      ['updateTask', { taskId: 't1', taskListId: 'l-work', title: { kind: 'keep' }, notes: { kind: 'set', value: '[status: doing]\ncall Bob' }, due: { kind: 'keep' } }],
    ]);
  });

  it('set_task_status done completes the task and tags it done', async () => {
    const { handlers, calls } = handlersWith({});

    jsonOf(await handlers.setTaskStatus({ taskId: 't1', status: 'done' }));

    expect(calls.map((call) => [call.method, call.input])).toEqual([
      ['completeTask', { taskId: 't1', taskListId: 'l-daily' }],
      ['updateTask', { taskId: 't1', taskListId: 'l-daily', title: { kind: 'keep' }, notes: { kind: 'set', value: '[status: done]' }, due: { kind: 'keep' } }],
    ]);
  });

  it('create_task with status writes the tag as the first line of the notes', async () => {
    const { handlers, calls } = handlersWith({});

    jsonOf(await handlers.createTask({ title: 'x', notes: 'details', status: 'doing' }));
    jsonOf(await handlers.createTask({ title: 'y', status: 'todo' }));
    jsonOf(await handlers.createTask({ title: 'z', notes: 'plain' }));

    expect(calls.map((call) => call.input)).toEqual([
      expect.objectContaining({ title: 'x', notes: '[status: doing]\ndetails' }),
      expect.objectContaining({ title: 'y', notes: '[status: todo]' }),
      expect.objectContaining({ title: 'z', notes: 'plain' }),
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

  it('list_tasks passes the API filters through to every list', async () => {
    const { handlers, calls } = handlersWith({});

    jsonOf(await handlers.listTasks({ list: 'Work', updatedMin: '2026-11-17', completedMax: '2026-11-30', showDeleted: true, showAssigned: true }));

    expect(calls[0]?.input).toEqual({
      due: { kind: 'any' },
      completed: 'include',
      completedAt: { kind: 'until', completedMax: '2026-12-01T00:00:00+09:00' },
      updated: { kind: 'since', updatedMin: '2026-11-17T00:00:00+09:00' },
      deleted: 'include',
      assigned: 'include',
      maxResults: 100,
      taskListId: 'l-work',
      page: { kind: 'first' },
    });
  });

  it('get_task reads one task from the resolved list', async () => {
    const { handlers, calls } = handlersWith({});

    expect(jsonOf(await handlers.getTask({ taskId: 't9', list: 'Work' }))).toMatchObject({ id: 't9', taskListId: 'l-work', deleted: false, links: [], assignment: null });
    expect(calls).toEqual([{ method: 'getTask', input: { taskId: 't9', taskListId: 'l-work' } }]);
  });

  it('get_task_list reads an id or @default with one GET, and a title by listing after the GET by id fails', async () => {
    const { handlers, lookups } = handlersWith({});

    expect(jsonOf(await handlers.getTaskList({ list: 'l-work' }))).toEqual({ id: 'l-work', title: 'Work', updated: 'u' });
    expect(jsonOf(await handlers.getTaskList({ list: '@default' }))).toEqual({ id: 'l-default', title: 'My Tasks', updated: 'u' });
    expect(jsonOf(await handlers.getTaskList({ list: 'work' }))).toEqual({ id: 'l-work', title: 'Work', updated: 'u' });
    expect(lookups).toEqual(['getTaskList l-work', 'getTaskList @default', 'getTaskList work', 'listTaskLists']);
  });

  it('move_task reorders / nests a task within its resolved list', async () => {
    const { handlers, calls } = handlersWith({});

    expect(jsonOf(await handlers.moveTask({ taskId: 't1', list: 'Work', parentId: 'p1', previousId: 's1' }))).toMatchObject({ id: 't1', taskListId: 'l-work' });
    expect(calls).toEqual([
      {
        method: 'moveTask',
        input: { taskId: 't1', taskListId: 'l-work', destination: { kind: 'sameList' }, placement: { kind: 'subtask', parentId: 'p1', position: { kind: 'after', previousId: 's1' } } },
      },
    ]);
  });

  it('move_task moves a task to another list named by title, listing the lists once for both titles', async () => {
    const { handlers, calls, lookups } = handlersWith({});

    expect(jsonOf(await handlers.moveTask({ taskId: 't1', list: 'My Tasks', destinationList: 'work' }))).toMatchObject({ taskListId: 'l-work' });
    expect(lookups).toEqual(['getTaskList My Tasks', 'getTaskList work', 'listTaskLists']);
    expect(calls).toEqual([
      { method: 'moveTask', input: { taskId: 't1', taskListId: 'l-default', destination: { kind: 'otherList', taskListId: 'l-work' }, placement: { kind: 'root', position: { kind: 'first' } } } },
    ]);
  });

  it("move_task resolves a '@default' destination to the default list's real id", async () => {
    const { handlers, calls, lookups } = handlersWith({});

    jsonOf(await handlers.moveTask({ taskId: 't1', list: 'l-work', destinationList: '@default' }));

    expect(lookups).toEqual(['getTaskList l-work', 'getTaskList @default']);
    expect(calls.map((call) => [call.method, call.input])).toEqual([
      ['moveTask', { taskId: 't1', taskListId: 'l-work', destination: { kind: 'otherList', taskListId: 'l-default' }, placement: { kind: 'root', position: { kind: 'first' } } }],
    ]);
  });

  it('move_task stays in the list when the destination resolves to the source list', async () => {
    const { handlers, calls } = handlersWith({});

    jsonOf(await handlers.moveTask({ taskId: 't1', list: 'Work', destinationList: 'l-work' }));

    expect(calls).toMatchObject([{ method: 'moveTask', input: { taskListId: 'l-work', destination: { kind: 'sameList' } } }]);
  });

  it('move_task rejects moving a task under itself before any Google call', async () => {
    const { handlers, calls } = handlersWith({ listTaskLists: unexpected });

    expect(errorTextOf(await handlers.moveTask({ taskId: 't1', list: 'Work', parentId: 't1' }))).toContain('parentId');
    expect(calls).toEqual([]);
  });

  it('move_task names the available lists when the destination does not exist, and moves nothing', async () => {
    const { handlers, calls } = handlersWith({});

    const text = errorTextOf(await handlers.moveTask({ taskId: 't1', destinationList: 'Nope' }));
    expect(text).toContain('"Nope"');
    expect(text).toContain('"Work"');
    expect(text).not.toContain('list was omitted');
    expect(calls).toEqual([]);
  });

  it('move_task without list moves the task out of the configured default list', async () => {
    const { handlers, calls, lookups } = handlersWith({});

    jsonOf(await handlers.moveTask({ taskId: 't1', destinationList: 'Work' }));

    expect(lookups).toEqual(['getTaskList 日常タスク', 'getTaskList Work', 'listTaskLists']);
    expect(calls).toEqual([
      { method: 'moveTask', input: { taskId: 't1', taskListId: 'l-daily', destination: { kind: 'otherList', taskListId: 'l-work' }, placement: { kind: 'root', position: { kind: 'first' } } } },
    ]);
  });

  it('clear_completed_tasks clears the resolved list and reports which list was cleared', async () => {
    const { handlers, calls } = handlersWith({});

    expect(jsonOf(await handlers.clearCompletedTasks({ list: 'Work', confirm: 'clear-completed' }))).toEqual({ cleared: true, taskList: { id: 'l-work', title: 'Work', updated: 'u' } });
    expect(jsonOf(await handlers.clearCompletedTasks({ list: '@default', confirm: 'clear-completed' }))).toEqual({ cleared: true, taskList: { id: 'l-default', title: 'My Tasks', updated: 'u' } });
    expect(calls).toEqual([
      { method: 'clearCompletedTasks', input: { taskListId: 'l-work' } },
      { method: 'clearCompletedTasks', input: { taskListId: 'l-default' } },
    ]);
  });

  it('clear_completed_tasks rejects a blank list and clears nothing when the list does not exist', async () => {
    const { handlers, calls } = handlersWith({});

    expect(errorTextOf(await handlers.clearCompletedTasks({ list: ' ', confirm: 'clear-completed' }))).toContain('" "');
    expect(errorTextOf(await handlers.clearCompletedTasks({ list: 'Nope', confirm: 'clear-completed' }))).toContain('"Work"');
    expect(calls).toEqual([]);
  });
});

const toolsListSchema = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        annotations: z.object({ readOnlyHint: z.boolean().optional(), destructiveHint: z.boolean().optional(), idempotentHint: z.boolean().optional() }).optional(),
      }),
    ),
  }),
});

// tools/list as a client sees it, for the tasks tools only.
const unusedTasks: ITasksService = {
  listTaskLists: unexpected,
  getTaskList: unexpected,
  createTaskList: unexpected,
  renameTaskList: unexpected,
  deleteTaskList: unexpected,
  listTasks: unexpected,
  getTask: unexpected,
  createTask: unexpected,
  updateTask: unexpected,
  completeTask: unexpected,
  reopenTask: unexpected,
  deleteTask: unexpected,
  moveTask: unexpected,
  clearCompletedTasks: unexpected,
};

const listTasksTools = async () => {
  const deps: ToolDeps = { services: { calendar, tasks: unusedTasks }, now: () => 0, connectURL: CONNECT_URL, defaultTaskList: DEFAULT_TASK_LIST };
  const server = new McpServer({ name: 'test', version: '0' }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  registerTasksTools(server, deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request('https://gct.example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
  return toolsListSchema.parse(await response.json()).result.tools;
};

describe('tasks tool annotations', () => {
  it('marks reads read-only, deletes / clear destructive, and every write not read-only', async () => {
    const tools = await listTasksTools();
    const hints = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));

    for (const name of ['list_task_lists', 'list_tasks', 'get_task', 'get_task_list']) expect(hints[name]).toMatchObject({ readOnlyHint: true });
    for (const name of ['delete_task', 'delete_task_list', 'clear_completed_tasks']) expect(hints[name]).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const name of ['create_task', 'update_task', 'complete_task', 'reopen_task', 'set_task_status', 'move_task', 'create_task_list', 'rename_task_list']) {
      expect(hints[name]).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    }
    expect(tools).toHaveLength(15);
  });
});

describe('tasks tool descriptions', () => {
  it('name the configured default list wherever list is optional', async () => {
    const tools = await listTasksTools();
    const descriptions = Object.fromEntries(tools.map((tool) => [tool.name, tool.description ?? '']));

    for (const name of ['get_task', 'create_task', 'update_task', 'complete_task', 'reopen_task', 'set_task_status', 'move_task', 'delete_task']) {
      expect(descriptions[name]).toContain(`"${DEFAULT_TASK_LIST}"`);
    }
    for (const description of Object.values(descriptions)) expect(description).not.toContain("the user's default list");
    expect(descriptions['list_tasks']).toContain('EVERY list');
  });
});
