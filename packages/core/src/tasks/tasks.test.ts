import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { AmbiguousTaskListError, GoogleNotFoundError, GooglePermissionError, GoogleResponseParseError, InvalidInputError, TaskListNotFoundError } from '../errors';
import { createGoogleClient } from '../google-client';

import { createTasksService, findTaskList, orderTasksHierarchically, resolveTaskList } from './index';

import type { ListTasksInput, Task, TaskListSummary, UpdateTaskInput } from './index';

type Captured = { url: string; init: RequestInit | undefined };

const fakeFetch = (respond: (url: string, init: RequestInit | undefined) => Response) => {
  const calls: Captured[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : `${input}`;
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fetch, calls };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const serviceWith = (respond: (url: string, init: RequestInit | undefined) => Response) => {
  const fake = fakeFetch(respond);
  const client = createGoogleClient({ fetch: fake.fetch, getAccessToken: () => okAsync('token') });
  return { service: createTasksService({ client }), calls: fake.calls };
};

const BASE = 'https://tasks.googleapis.com/tasks/v1';

const urlOf = (call: Captured | undefined): URL => new URL(call?.url ?? '');

const bodyOf = (call: Captured | undefined): unknown => JSON.parse(`${call?.init?.body ?? ''}`);

const wireTask = {
  kind: 'tasks#task',
  id: 'T1',
  etag: '"e"',
  title: 'Buy milk',
  updated: '2026-11-17T01:02:03.000Z',
  selfLink: 'https://www.googleapis.com/tasks/v1/lists/L1/tasks/T1',
  position: '00000000000000000001',
  notes: 'low fat',
  status: 'needsAction',
  due: '2026-11-20T00:00:00.000Z',
  links: [],
  webViewLink: 'https://tasks.google.com/task/T1',
};

const normalizedTask = {
  status: 'needsAction',
  id: 'T1',
  taskListId: '@default',
  title: 'Buy milk',
  notes: 'low fat',
  due: { kind: 'date', date: '2026-11-20' },
  hierarchy: { kind: 'root' },
  position: '00000000000000000001',
  updated: '2026-11-17T01:02:03.000Z',
  webViewLink: 'https://tasks.google.com/task/T1',
  links: [],
  assignment: { kind: 'none' },
  deleted: false,
  hidden: false,
};

const neverCalled = () => serviceWith(() => json(wireTask));

describe('listTaskLists', () => {
  it('GETs users/@me/lists and normalizes each task list', async () => {
    const { service, calls } = serviceWith(() =>
      json({
        kind: 'tasks#taskLists',
        etag: 'e',
        items: [
          { kind: 'tasks#taskList', id: 'L1', etag: 'x', title: 'My Tasks', updated: '2026-11-17T01:02:03.000Z', selfLink: 'https://x' },
          { kind: 'tasks#taskList', id: 'L2', title: 'Work', updated: '2026-11-16T00:00:00.000Z' },
        ],
      }),
    );

    const result = await service.listTaskLists();

    expect(calls[0]?.init?.method).toBe('GET');
    expect(urlOf(calls[0]).origin + urlOf(calls[0]).pathname).toBe(`${BASE}/users/@me/lists`);
    expect(result._unsafeUnwrap()).toStrictEqual([
      { id: 'L1', title: 'My Tasks', updated: '2026-11-17T01:02:03.000Z' },
      { id: 'L2', title: 'Work', updated: '2026-11-16T00:00:00.000Z' },
    ]);
  });

  it('follows nextPageToken until the last page', async () => {
    const list = (id: string) => ({ id, title: id, updated: '2026-11-17T00:00:00.000Z' });
    const { service, calls } = serviceWith((url) => {
      const token = new URL(url).searchParams.get('pageToken');
      if (token === null) return json({ items: [list('L1')], nextPageToken: 'p2' });
      if (token === 'p2') return json({ items: [list('L2')], nextPageToken: 'p3' });
      return json({ items: [list('L3')] });
    });

    const result = await service.listTaskLists();

    expect(calls.map((call) => urlOf(call).searchParams.get('pageToken'))).toStrictEqual([null, 'p2', 'p3']);
    expect(result._unsafeUnwrap().map((list) => list.id)).toStrictEqual(['L1', 'L2', 'L3']);
  });

  it('returns an empty array when Google omits items', async () => {
    const { service } = serviceWith(() => json({ kind: 'tasks#taskLists' }));

    const result = await service.listTaskLists();

    expect(result._unsafeUnwrap()).toStrictEqual([]);
  });

  it('propagates Google errors as error classes', async () => {
    const { service } = serviceWith(() => json({ error: { code: 404, message: 'gone' } }, 404));

    const result = await service.listTaskLists();

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});

describe('getTask', () => {
  it('GETs the task from the default list and normalizes it into the needsAction variant', async () => {
    const { service, calls } = serviceWith(() => json(wireTask));

    const result = await service.getTask({ taskId: 'T1' });

    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.url).toBe(`${BASE}/lists/%40default/tasks/T1`);
    expect(result._unsafeUnwrap()).toStrictEqual(normalizedTask);
  });

  it('URL-encodes the task list id and task id', async () => {
    const { service, calls } = serviceWith(() => json(wireTask));

    await service.getTask({ taskListId: 'a/b c', taskId: 'x?y#z' });

    expect(calls[0]?.url).toBe(`${BASE}/lists/a%2Fb%20c/tasks/x%3Fy%23z`);
  });

  it('normalizes a completed subtask with no notes and no due date', async () => {
    const { service } = serviceWith(() => json({ ...wireTask, id: 'T2', title: 'Sub', status: 'completed', completed: '2026-11-17T09:00:00.000Z', parent: 'T1', notes: null, due: undefined }));

    const result = await service.getTask({ taskListId: 'L1', taskId: 'T2' });

    expect(result._unsafeUnwrap()).toStrictEqual({
      status: 'completed',
      completedAt: '2026-11-17T09:00:00.000Z',
      id: 'T2',
      taskListId: 'L1',
      title: 'Sub',
      notes: '',
      due: { kind: 'none' },
      hierarchy: { kind: 'subtask', parentId: 'T1' },
      position: '00000000000000000001',
      updated: '2026-11-17T01:02:03.000Z',
      webViewLink: 'https://tasks.google.com/task/T1',
      links: [],
      assignment: { kind: 'none' },
      deleted: false,
      hidden: false,
    });
  });

  it('ignores a stray completed timestamp on a needsAction task', async () => {
    const { service } = serviceWith(() => json({ ...wireTask, completed: '2026-11-17T09:00:00.000Z' }));

    const result = await service.getTask({ taskId: 'T1' });

    expect(result._unsafeUnwrap()).toStrictEqual(normalizedTask);
  });

  it('fails with GoogleResponseParseError when a completed task has no completed timestamp', async () => {
    const { service } = serviceWith(() => json({ ...wireTask, status: 'completed' }));

    const result = await service.getTask({ taskId: 'T1' });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleResponseParseError);
  });

  it('derives due from the UTC date even when Google sends an offset', async () => {
    const { service } = serviceWith(() => json({ ...wireTask, due: '2026-11-20T23:30:00-05:00' }));

    const result = await service.getTask({ taskId: 'T1' });

    expect(result._unsafeUnwrap().due).toStrictEqual({ kind: 'date', date: '2026-11-21' });
  });

  it('defaults a missing title to an empty string', async () => {
    const { service } = serviceWith(() => json({ ...wireTask, title: undefined }));

    const result = await service.getTask({ taskId: 'T1' });

    expect(result._unsafeUnwrap().title).toBe('');
  });

  it('propagates GoogleNotFoundError', async () => {
    const { service } = serviceWith(() => json({ error: { code: 404, message: 'Not Found' } }, 404));

    const result = await service.getTask({ taskId: 'missing' });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});

describe('task read-only output fields', () => {
  it('normalizes links, deleted and hidden', async () => {
    const { service } = serviceWith(() =>
      json({
        ...wireTask,
        deleted: true,
        hidden: true,
        links: [
          { type: 'email', description: 'Re: invoice', link: 'https://mail.google.com/mail/#all/abc' },
          { type: 'generic', link: 'https://example.com' },
        ],
      }),
    );

    const task = (await service.getTask({ taskId: 'T1' }))._unsafeUnwrap();

    expect(task.deleted).toBe(true);
    expect(task.hidden).toBe(true);
    expect(task.links).toStrictEqual([
      { type: 'email', description: 'Re: invoice', link: 'https://mail.google.com/mail/#all/abc' },
      { type: 'generic', description: '', link: 'https://example.com' },
    ]);
  });

  it.each([
    [
      'a Docs assignment',
      { linkToTask: 'https://docs.google.com/d/1', surfaceType: 'DOCUMENT', driveResourceInfo: { driveFileId: 'F1', resourceKey: 'K1' } },
      { kind: 'assigned', linkToTask: 'https://docs.google.com/d/1', source: { kind: 'document', driveFileId: 'F1', resourceKey: 'K1' } },
    ],
    [
      'a Docs assignment without a resource key',
      { linkToTask: 'https://docs.google.com/d/1', surfaceType: 'DOCUMENT', driveResourceInfo: { driveFileId: 'F1' } },
      { kind: 'assigned', linkToTask: 'https://docs.google.com/d/1', source: { kind: 'document', driveFileId: 'F1', resourceKey: '' } },
    ],
    [
      'a Chat space assignment',
      { linkToTask: 'https://chat.google.com/x', surfaceType: 'SPACE', spaceInfo: { space: 'spaces/AAA' } },
      { kind: 'assigned', linkToTask: 'https://chat.google.com/x', source: { kind: 'space', space: 'spaces/AAA' } },
    ],
    [
      'an assignment from a surface without details',
      { linkToTask: 'https://mail.google.com/x', surfaceType: 'GMAIL' },
      { kind: 'assigned', linkToTask: 'https://mail.google.com/x', source: { kind: 'other', surfaceType: 'GMAIL' } },
    ],
    ['an unknown, empty assignment', {}, { kind: 'assigned', linkToTask: '', source: { kind: 'other', surfaceType: 'CONTEXT_TYPE_UNSPECIFIED' } }],
  ] as const)('normalizes %s', async (_label, assignmentInfo, expected) => {
    const { service } = serviceWith(() => json({ ...wireTask, assignmentInfo }));

    const task = (await service.getTask({ taskId: 'T1' }))._unsafeUnwrap();

    expect(task.assignment).toStrictEqual(expected);
  });

  it('tolerates null links / flags / assignment and a deleted task without position or webViewLink', async () => {
    const { service } = serviceWith(() => json({ ...wireTask, links: null, deleted: null, hidden: null, assignmentInfo: null, position: undefined, webViewLink: undefined }));

    const task = (await service.getTask({ taskId: 'T1' }))._unsafeUnwrap();

    expect(task).toMatchObject({ links: [], deleted: false, hidden: false, assignment: { kind: 'none' }, position: '', webViewLink: '' });
  });
});

describe('deleteTask', () => {
  it('DELETEs the task and resolves to undefined on 204', async () => {
    const { service, calls } = serviceWith(() => new Response(null, { status: 204 }));

    const result = await service.deleteTask({ taskListId: 'L1', taskId: 'T1' });

    expect(calls[0]?.init?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(`${BASE}/lists/L1/tasks/T1`);
    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it('defaults to @default and propagates GoogleNotFoundError', async () => {
    const { service, calls } = serviceWith(() => json({ error: { code: 404, message: 'Not Found' } }, 404));

    const result = await service.deleteTask({ taskId: 'T1' });

    expect(calls[0]?.url).toBe(`${BASE}/lists/%40default/tasks/T1`);
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});

describe('completeTask', () => {
  it('PATCHes status=completed and returns the completed variant', async () => {
    const { service, calls } = serviceWith(() => json({ ...wireTask, status: 'completed', completed: '2026-11-17T10:00:00.000Z' }));

    const result = await service.completeTask({ taskListId: 'L1', taskId: 'T1' });

    expect(calls[0]?.init?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe(`${BASE}/lists/L1/tasks/T1`);
    expect(bodyOf(calls[0])).toStrictEqual({ status: 'completed' });
    expect(result._unsafeUnwrap()).toMatchObject({ id: 'T1', taskListId: 'L1', status: 'completed', completedAt: '2026-11-17T10:00:00.000Z' });
  });
});

describe('reopenTask', () => {
  it('PATCHes status=needsAction, clears completed with null and returns the needsAction variant', async () => {
    const { service, calls } = serviceWith(() => json(wireTask));

    const result = await service.reopenTask({ taskId: 'T1' });

    expect(calls[0]?.init?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe(`${BASE}/lists/%40default/tasks/T1`);
    expect(bodyOf(calls[0])).toStrictEqual({ status: 'needsAction', completed: null });
    expect(result._unsafeUnwrap()).toStrictEqual(normalizedTask);
  });
});

describe('createTask', () => {
  it('POSTs title, notes and due (as midnight UTC) as a first top-level task', async () => {
    const { service, calls } = serviceWith(() => json(wireTask));

    const result = await service.createTask({ title: 'Buy milk', notes: 'low fat', due: { kind: 'date', date: '2026-11-20' }, placement: { kind: 'root', position: { kind: 'first' } } });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.url).toBe(`${BASE}/lists/%40default/tasks`);
    expect(bodyOf(calls[0])).toStrictEqual({ title: 'Buy milk', notes: 'low fat', due: '2026-11-20T00:00:00.000Z' });
    expect(result._unsafeUnwrap()).toStrictEqual(normalizedTask);
  });

  it('omits notes when empty and due when none', async () => {
    const { service, calls } = serviceWith(() => json(wireTask));

    await service.createTask({ taskListId: 'L1', title: 'Buy milk', notes: '', due: { kind: 'none' }, placement: { kind: 'root', position: { kind: 'first' } } });

    expect(calls[0]?.url).toBe(`${BASE}/lists/L1/tasks`);
    expect(bodyOf(calls[0])).toStrictEqual({ title: 'Buy milk' });
  });

  it.each([
    ['a top-level task after a sibling', { kind: 'root', position: { kind: 'after', previousId: 'S0' } }, { parent: null, previous: 'S0' }],
    ['the first subtask of a parent', { kind: 'subtask', parentId: 'P1', position: { kind: 'first' } }, { parent: 'P1', previous: null }],
    ['a subtask after a sibling', { kind: 'subtask', parentId: 'P1', position: { kind: 'after', previousId: 'S0' } }, { parent: 'P1', previous: 'S0' }],
  ] as const)('places %s via the parent / previous query parameters', async (_label, placement, expected) => {
    const { service, calls } = serviceWith(() => json(wireTask));

    await service.createTask({ title: 'Sub', notes: '', due: { kind: 'none' }, placement });

    const url = urlOf(calls[0]);
    expect(url.searchParams.get('parent')).toBe(expected.parent);
    expect(url.searchParams.get('previous')).toBe(expected.previous);
    expect(bodyOf(calls[0])).toStrictEqual({ title: 'Sub' });
  });

  it('sends neither parent nor previous for a first top-level task', async () => {
    const { service, calls } = serviceWith(() => json(wireTask));

    await service.createTask({ title: 'Top', notes: '', due: { kind: 'none' }, placement: { kind: 'root', position: { kind: 'first' } } });

    expect(urlOf(calls[0]).search).toBe('');
  });

  it.each(['', '   '])('rejects the empty title %j without calling Google', async (title) => {
    const { service, calls } = neverCalled();

    const result = await service.createTask({ title, notes: '', due: { kind: 'none' }, placement: { kind: 'root', position: { kind: 'first' } } });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('title');
    expect(calls).toHaveLength(0);
  });

  it.each(['2026-11-20T10:00:00+09:00', '2026/11/20', '20261120', '2026-2-3', '2026-02-30', '2026-13-01'])(
    'rejects due %j with the expected format and a fix, without calling Google',
    async (date) => {
      const { service, calls } = neverCalled();

      const result = await service.createTask({ title: 'x', notes: '', due: { kind: 'date', date }, placement: { kind: 'root', position: { kind: 'first' } } });

      const error = result._unsafeUnwrapErr();
      expect(error).toBeInstanceOf(InvalidInputError);
      expect(error.message).toContain(date);
      expect(error.message).toContain('YYYY-MM-DD');
      expect(calls).toHaveLength(0);
    },
  );
});

const keepAll = {
  title: { kind: 'keep' },
  notes: { kind: 'keep' },
  due: { kind: 'keep' },
} satisfies Omit<UpdateTaskInput, 'taskId' | 'taskListId'>;

describe('updateTask', () => {
  it('PATCHes only the fields that are set and leaves kept fields out of the body', async () => {
    const { service, calls } = serviceWith(() => json(wireTask));

    const result = await service.updateTask({ ...keepAll, taskListId: 'L1', taskId: 'T1', title: { kind: 'set', value: 'Renamed' } });

    expect(calls[0]?.init?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe(`${BASE}/lists/L1/tasks/T1`);
    expect(bodyOf(calls[0])).toStrictEqual({ title: 'Renamed' });
    expect(result._unsafeUnwrap()).toMatchObject({ id: 'T1', taskListId: 'L1' });
  });

  it('sets notes and due (due as midnight UTC)', async () => {
    const { service, calls } = serviceWith(() => json(wireTask));

    await service.updateTask({ ...keepAll, taskId: 'T1', notes: { kind: 'set', value: 'n' }, due: { kind: 'set', value: '2026-12-01' } });

    expect(calls[0]?.url).toBe(`${BASE}/lists/%40default/tasks/T1`);
    expect(bodyOf(calls[0])).toStrictEqual({ notes: 'n', due: '2026-12-01T00:00:00.000Z' });
  });

  it('clears notes and due by sending null', async () => {
    const { service, calls } = serviceWith(() => json({ ...wireTask, notes: null, due: null }));

    const result = await service.updateTask({ ...keepAll, taskId: 'T1', notes: { kind: 'clear' }, due: { kind: 'clear' } });

    expect(bodyOf(calls[0])).toStrictEqual({ notes: null, due: null });
    expect(result._unsafeUnwrap()).toMatchObject({ notes: '', due: { kind: 'none' } });
  });

  it('rejects an update that keeps every field without calling Google', async () => {
    const { service, calls } = neverCalled();

    const result = await service.updateTask({ ...keepAll, taskId: 'T1' });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('title');
    expect(error.message).toContain('notes');
    expect(error.message).toContain('due');
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty title without calling Google', async () => {
    const { service, calls } = neverCalled();

    const result = await service.updateTask({ ...keepAll, taskId: 'T1', title: { kind: 'set', value: ' ' } });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(InvalidInputError);
    expect(calls).toHaveLength(0);
  });

  it('rejects a due that is not YYYY-MM-DD without calling Google', async () => {
    const { service, calls } = neverCalled();

    const result = await service.updateTask({ ...keepAll, taskId: 'T1', due: { kind: 'set', value: '2026-12-01T09:00:00Z' } });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('2026-12-01T09:00:00Z');
    expect(error.message).toContain('YYYY-MM-DD');
    expect(calls).toHaveLength(0);
  });
});

const listAll = {
  due: { kind: 'any' },
  completed: 'include',
  completedAt: { kind: 'any' },
  updated: { kind: 'any' },
  deleted: 'exclude',
  assigned: 'exclude',
  page: { kind: 'first' },
  maxResults: 100,
} satisfies Omit<ListTasksInput, 'taskListId'>;

describe('listTasks', () => {
  it('GETs the default list and returns one normalized page with the next page token', async () => {
    const { service, calls } = serviceWith(() => json({ kind: 'tasks#tasks', etag: 'e', items: [wireTask], nextPageToken: 'next' }));

    const result = await service.listTasks(listAll);

    expect(calls[0]?.init?.method).toBe('GET');
    expect(urlOf(calls[0]).origin + urlOf(calls[0]).pathname).toBe(`${BASE}/lists/%40default/tasks`);
    expect(result._unsafeUnwrap()).toStrictEqual({ items: [normalizedTask], next: { kind: 'more', pageToken: 'next' } });
  });

  it('marks the last page when Google omits nextPageToken and items', async () => {
    const { service } = serviceWith(() => json({ kind: 'tasks#tasks' }));

    const result = await service.listTasks({ ...listAll, taskListId: 'L1' });

    expect(result._unsafeUnwrap()).toStrictEqual({ items: [], next: { kind: 'last' } });
  });

  it('sends maxResults and the page token, and URL-encodes the list id', async () => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    await service.listTasks({ ...listAll, taskListId: 'L/1', maxResults: 50, page: { kind: 'token', pageToken: 'p2' } });

    const url = urlOf(calls[0]);
    expect(url.pathname).toBe('/tasks/v1/lists/L%2F1/tasks');
    expect(url.searchParams.get('maxResults')).toBe('50');
    expect(url.searchParams.get('pageToken')).toBe('p2');
  });

  it('sends no due bounds and no pageToken for an unfiltered first page', async () => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    await service.listTasks(listAll);

    const url = urlOf(calls[0]);
    expect(url.searchParams.has('dueMin')).toBe(false);
    expect(url.searchParams.has('dueMax')).toBe(false);
    expect(url.searchParams.has('pageToken')).toBe(false);
  });

  it.each([
    ['exclude', 'false', 'false'],
    ['include', 'true', 'false'],
    ['includeHidden', 'true', 'true'],
  ] as const)('maps completed=%s to showCompleted=%s / showHidden=%s', async (completed, showCompleted, showHidden) => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    await service.listTasks({ ...listAll, completed });

    const url = urlOf(calls[0]);
    expect(url.searchParams.get('showCompleted')).toBe(showCompleted);
    expect(url.searchParams.get('showHidden')).toBe(showHidden);
  });

  // Stored dues are midnight UTC; sending dueMax as the end of that UTC day keeps the day
  // included whether Google treats the upper bound as inclusive or exclusive.
  it.each([
    ['from', { kind: 'from', dueMin: '2026-11-01' }, '2026-11-01T00:00:00.000Z', null],
    ['until', { kind: 'until', dueMax: '2026-11-30' }, null, '2026-11-30T23:59:59.999Z'],
    ['between', { kind: 'between', dueMin: '2026-11-01', dueMax: '2026-11-30' }, '2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z'],
    ['between (single day)', { kind: 'between', dueMin: '2026-11-01', dueMax: '2026-11-01' }, '2026-11-01T00:00:00.000Z', '2026-11-01T23:59:59.999Z'],
  ] as const)('converts a %s due filter to RFC 3339 bounds', async (_label, due, dueMin, dueMax) => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    const result = await service.listTasks({ ...listAll, due });

    expect(result.isOk()).toBe(true);
    const url = urlOf(calls[0]);
    expect(url.searchParams.get('dueMin')).toBe(dueMin);
    expect(url.searchParams.get('dueMax')).toBe(dueMax);
  });

  it.each([
    ['dueMin', { kind: 'from', dueMin: '2026-11-01T00:00:00Z' }, '2026-11-01T00:00:00Z'],
    ['dueMax', { kind: 'until', dueMax: '11/30/2026' }, '11/30/2026'],
    ['dueMin', { kind: 'between', dueMin: '2026-02-30', dueMax: '2026-03-31' }, '2026-02-30'],
    ['dueMax', { kind: 'between', dueMin: '2026-03-01', dueMax: '2026-3-31' }, '2026-3-31'],
  ] as const)('rejects a malformed %s without calling Google', async (field, due, value) => {
    const { service, calls } = neverCalled();

    const result = await service.listTasks({ ...listAll, due });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain(field);
    expect(error.message).toContain(value);
    expect(error.message).toContain('YYYY-MM-DD');
    expect(calls).toHaveLength(0);
  });

  it('rejects dueMin after dueMax without calling Google', async () => {
    const { service, calls } = neverCalled();

    const result = await service.listTasks({ ...listAll, due: { kind: 'between', dueMin: '2026-12-01', dueMax: '2026-11-01' } });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('2026-12-01');
    expect(error.message).toContain('2026-11-01');
    expect(calls).toHaveLength(0);
  });

  it.each([0, 101, 1.5, -1])('rejects maxResults %d without calling Google', async (maxResults) => {
    const { service, calls } = neverCalled();

    const result = await service.listTasks({ ...listAll, maxResults });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain(`${maxResults}`);
    expect(error.message).toContain('1 and 100');
    expect(calls).toHaveLength(0);
  });
});

describe('listTasks API filters', () => {
  it('sends no updatedMin / completed bounds and showDeleted=false / showAssigned=false by default', async () => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    await service.listTasks(listAll);

    const url = urlOf(calls[0]);
    expect(url.searchParams.has('updatedMin')).toBe(false);
    expect(url.searchParams.has('completedMin')).toBe(false);
    expect(url.searchParams.has('completedMax')).toBe(false);
    expect(url.searchParams.get('showDeleted')).toBe('false');
    expect(url.searchParams.get('showAssigned')).toBe('false');
  });

  it('sends updatedMin as the given RFC 3339 instant', async () => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    await service.listTasks({ ...listAll, updated: { kind: 'since', updatedMin: '2026-11-17T00:00:00+09:00' } });

    expect(urlOf(calls[0]).searchParams.get('updatedMin')).toBe('2026-11-17T00:00:00+09:00');
  });

  it.each([
    ['from', { kind: 'from', completedMin: '2026-11-01T00:00:00+09:00' }, '2026-11-01T00:00:00+09:00', null],
    ['until', { kind: 'until', completedMax: '2026-12-01T00:00:00Z' }, null, '2026-12-01T00:00:00Z'],
    ['between', { kind: 'between', completedMin: '2026-11-01T00:00:00Z', completedMax: '2026-12-01T00:00:00Z' }, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'],
  ] as const)('sends a %s completedAt filter as completedMin / completedMax', async (_label, completedAt, completedMin, completedMax) => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    const result = await service.listTasks({ ...listAll, completedAt });

    expect(result.isOk()).toBe(true);
    const url = urlOf(calls[0]);
    expect(url.searchParams.get('completedMin')).toBe(completedMin);
    expect(url.searchParams.get('completedMax')).toBe(completedMax);
  });

  it.each([
    ['include', 'exclude', 'true', 'false'],
    ['exclude', 'include', 'false', 'true'],
  ] as const)('maps deleted=%s / assigned=%s to showDeleted=%s / showAssigned=%s', async (deleted, assigned, showDeleted, showAssigned) => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    await service.listTasks({ ...listAll, deleted, assigned });

    const url = urlOf(calls[0]);
    expect(url.searchParams.get('showDeleted')).toBe(showDeleted);
    expect(url.searchParams.get('showAssigned')).toBe(showAssigned);
  });

  it.each([
    ['updatedMin', { updated: { kind: 'since', updatedMin: '2026-11-17' } }, '2026-11-17'],
    ['updatedMin', { updated: { kind: 'since', updatedMin: '2026-11-17T10:00:00' } }, '2026-11-17T10:00:00'],
    ['completedMin', { completedAt: { kind: 'from', completedMin: '2026-11-17 10:00' } }, '2026-11-17 10:00'],
    ['completedMax', { completedAt: { kind: 'until', completedMax: '2026-02-30T00:00:00Z' } }, '2026-02-30T00:00:00Z'],
    ['completedMax', { completedAt: { kind: 'between', completedMin: '2026-11-01T00:00:00Z', completedMax: 'tomorrow' } }, 'tomorrow'],
  ] as const)('rejects a malformed %s without calling Google', async (field, filter, value) => {
    const { service, calls } = neverCalled();

    const result = await service.listTasks({ ...listAll, ...filter });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain(field);
    expect(error.message).toContain(`"${value}"`);
    expect(error.message).toContain('RFC 3339');
    expect(calls).toHaveLength(0);
  });

  it('rejects completedMin after completedMax without calling Google', async () => {
    const { service, calls } = neverCalled();

    const result = await service.listTasks({ ...listAll, completedAt: { kind: 'between', completedMin: '2026-12-01T00:00:00+09:00', completedMax: '2026-11-01T00:00:00+09:00' } });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('2026-12-01T00:00:00+09:00');
    expect(error.message).toContain('2026-11-01T00:00:00+09:00');
    expect(calls).toHaveLength(0);
  });

  it('rejects a completedAt filter while completed tasks are excluded, without calling Google', async () => {
    const { service, calls } = neverCalled();

    const result = await service.listTasks({ ...listAll, completed: 'exclude', completedAt: { kind: 'from', completedMin: '2026-11-01T00:00:00Z' } });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain("'exclude'");
    expect(error.message).toContain("'include'");
    expect(calls).toHaveLength(0);
  });
});

describe('orderTasksHierarchically', () => {
  const at = (id: string, parentId: string | undefined, position: string, updated = '2026-11-17T00:00:00.000Z'): Task => ({
    status: 'needsAction',
    id,
    taskListId: 'L1',
    title: id,
    notes: '',
    due: { kind: 'none' },
    hierarchy: parentId === undefined ? { kind: 'root' } : { kind: 'subtask', parentId },
    position,
    updated,
    webViewLink: '',
    links: [],
    assignment: { kind: 'none' },
    deleted: false,
    hidden: false,
  });

  const shape = (tasks: readonly Task[]): readonly (readonly [string, number])[] => orderTasksHierarchically(tasks).map(({ task, depth }) => [task.id, depth] as const);

  it('puts each parent before its subtasks, even when a subtask sorts first by position', () => {
    // As Google returned them in the report: child → sub → parent, all at position 0.
    const tasks = [at('child', 'parent', '00000000000000000000'), at('sub', 'parent', '00000000000000000001'), at('parent', undefined, '00000000000000000002')];
    expect(shape(tasks)).toEqual([
      ['parent', 0],
      ['child', 1],
      ['sub', 1],
    ]);
  });

  it('sorts top-level tasks and each sibling group by position', () => {
    const tasks = [at('b', undefined, '2'), at('b2', 'b', '2'), at('a', undefined, '1'), at('b1', 'b', '1'), at('a1', 'a', '1')];
    expect(shape(tasks)).toEqual([
      ['a', 0],
      ['a1', 1],
      ['b', 0],
      ['b1', 1],
      ['b2', 1],
    ]);
  });

  it('nests deeper levels recursively', () => {
    const tasks = [at('grandchild', 'child', '0'), at('child', 'root', '0'), at('root', undefined, '0')];
    expect(shape(tasks)).toEqual([
      ['root', 0],
      ['child', 1],
      ['grandchild', 2],
    ]);
  });

  it('breaks a position tie by the most recently updated first, then by id', () => {
    const tasks = [at('old', undefined, '0', '2026-11-17T00:00:00.000Z'), at('z-new', undefined, '0', '2026-11-17T09:00:00.000Z'), at('y-new', undefined, '0', '2026-11-17T09:00:00.000Z')];
    expect(shape(tasks)).toEqual([
      ['y-new', 0],
      ['z-new', 0],
      ['old', 0],
    ]);
  });

  it('keeps subtasks whose parent is not in the page after the top-level tasks, with their own subtasks', () => {
    const tasks = [at('orphan-b', 'gone', '2'), at('orphan-a', 'gone', '1'), at('kid', 'orphan-b', '0'), at('top', undefined, '9')];
    expect(shape(tasks)).toEqual([
      ['top', 0],
      ['orphan-a', 0],
      ['orphan-b', 0],
      ['kid', 1],
    ]);
  });

  it('never drops a task, even when parents form a cycle', () => {
    const tasks = [at('x', 'y', '0'), at('y', 'x', '1'), at('top', undefined, '0')];
    expect(shape(tasks)).toEqual([
      ['top', 0],
      ['x', 0],
      ['y', 0],
    ]);
  });

  it('keeps each task unchanged (hierarchy included) and does not reorder the input', () => {
    const tasks = [at('child', 'parent', '0'), at('parent', undefined, '1')];
    const ordered = orderTasksHierarchically(tasks);
    expect(ordered.map(({ task }) => task)).toStrictEqual([tasks[1], tasks[0]]);
    expect(tasks.map((task) => task.id)).toEqual(['child', 'parent']);
  });

  it('returns nothing for an empty page', () => {
    expect(orderTasksHierarchically([])).toEqual([]);
  });
});

describe('resolveTaskList', () => {
  const summary = (id: string, title: string): TaskListSummary => ({ id, title, updated: '2026-11-17T00:00:00.000Z' });
  const LISTS: readonly TaskListSummary[] = [summary('MDE', 'マイタスク'), summary('MDI', '日常タスク'), summary('MDV', 'VRC タスク')];

  it('matches a list id exactly', () => {
    expect(resolveTaskList(LISTS, 'MDI')._unsafeUnwrap()).toStrictEqual(LISTS[1]);
  });

  it('matches a title', () => {
    expect(resolveTaskList(LISTS, '日常タスク')._unsafeUnwrap()).toStrictEqual(LISTS[1]);
  });

  it('matches a title case-insensitively after NFKC normalization and trimming', () => {
    // Full-width "ＶＲＣ", an ideographic space, surrounding blanks.
    expect(resolveTaskList(LISTS, '  ｖｒｃ\u3000タスク ')._unsafeUnwrap()).toStrictEqual(LISTS[2]);
  });

  it('prefers an id match over a title that equals it', () => {
    const lists = [summary('A', 'B'), summary('B', 'other')];
    expect(resolveTaskList(lists, 'B')._unsafeUnwrap()).toStrictEqual(lists[1]);
  });

  it('does not match an id case-insensitively', () => {
    expect(resolveTaskList(LISTS, 'mdi')._unsafeUnwrapErr()).toBeInstanceOf(TaskListNotFoundError);
  });

  it('fails with TaskListNotFoundError naming the query and every list title', () => {
    const error = resolveTaskList(LISTS, 'nope')._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(TaskListNotFoundError);
    expect(error.message).toContain('"nope"');
    expect(error.message).toContain('"マイタスク", "日常タスク", "VRC タスク"');
    expect(error.message).toContain('@default');
  });

  it('says when there are no task lists at all', () => {
    expect(resolveTaskList([], 'nope')._unsafeUnwrapErr().message).toContain('no task lists');
  });

  it('fails with AmbiguousTaskListError listing the candidates with their ids', () => {
    const lists = [summary('L1', 'Work'), summary('L2', 'work '), summary('L3', 'Home')];
    const error = resolveTaskList(lists, 'WORK')._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(AmbiguousTaskListError);
    expect(error.message).toContain('"WORK"');
    expect(error.message).toContain('"Work" (id L1)');
    expect(error.message).toContain('"work " (id L2)');
    expect(error.message).not.toContain('L3');
  });
});

describe('findTaskList', () => {
  const wireList = (id: string, title: string) => ({ kind: 'tasks#taskList', id, title, updated: '2026-11-17T00:00:00.000Z' });
  const ALL = { kind: 'tasks#taskLists', items: [wireList('MDE', 'マイタスク'), wireList('MDI', '日常タスク')] };

  // GET lists/{id} knows only real ids; anything else answers `missing` (404 or 400, as Google does for a malformed id).
  const google = (missing: Response) =>
    serviceWith((url) => {
      if (url === `${BASE}/users/@me/lists`) return json(ALL);
      if (url === `${BASE}/users/@me/lists/MDI`) return json(wireList('MDI', '日常タスク'));
      return missing.clone();
    });

  it('reads an id with a single GET by id, without listing every list', async () => {
    const { service, calls } = google(json({ error: { code: 404, message: 'Not Found' } }, 404));

    expect((await findTaskList(service, 'MDI'))._unsafeUnwrap()).toStrictEqual({ id: 'MDI', title: '日常タスク', updated: '2026-11-17T00:00:00.000Z' });
    expect(calls.map((call) => call.url)).toStrictEqual([`${BASE}/users/@me/lists/MDI`]);
  });

  it.each([
    ['404', json({ error: { code: 404, message: 'Not Found' } }, 404)],
    ['400 (invalid id)', json({ error: { code: 400, message: 'Invalid task list ID' } }, 400)],
  ])('falls back to matching the title in every list when the GET by id answers %s', async (_label, missing) => {
    const { service, calls } = google(missing);

    expect((await findTaskList(service, '日常タスク'))._unsafeUnwrap().id).toBe('MDI');
    expect(calls.map((call) => call.url)).toStrictEqual([`${BASE}/users/@me/lists/${encodeURIComponent('日常タスク')}`, `${BASE}/users/@me/lists`]);
  });

  it('keeps the not-found error that names the available titles', async () => {
    const { service } = google(json({ error: { code: 404, message: 'Not Found' } }, 404));

    const error = (await findTaskList(service, 'nope'))._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(TaskListNotFoundError);
    expect(error.message).toContain('"マイタスク", "日常タスク"');
  });

  it('propagates any other failure of the GET by id without listing', async () => {
    const { service, calls } = google(json({ error: { code: 403, message: 'Forbidden' } }, 403));

    expect((await findTaskList(service, 'MDX'))._unsafeUnwrapErr()).toBeInstanceOf(GooglePermissionError);
    expect(calls).toHaveLength(1);
  });
});

const wireTaskList = { kind: 'tasks#taskList', id: 'L1', etag: '"e"', title: 'Work', updated: '2026-11-17T01:02:03.000Z', selfLink: 'https://www.googleapis.com/tasks/v1/users/@me/lists/L1' };

const normalizedTaskList = { id: 'L1', title: 'Work', updated: '2026-11-17T01:02:03.000Z' };

const neverCalledList = () => serviceWith(() => json(wireTaskList));

describe('getTaskList', () => {
  it('GETs users/@me/lists/{id} and normalizes the list', async () => {
    const { service, calls } = serviceWith(() => json(wireTaskList));

    const result = await service.getTaskList({ taskListId: 'L1' });

    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.url).toBe(`${BASE}/users/@me/lists/L1`);
    expect(result._unsafeUnwrap()).toStrictEqual(normalizedTaskList);
  });

  it('accepts @default and URL-encodes the id', async () => {
    const { service, calls } = serviceWith(() => json(wireTaskList));

    await service.getTaskList({ taskListId: '@default' });
    await service.getTaskList({ taskListId: 'a/b c' });

    expect(calls.map((call) => call.url)).toStrictEqual([`${BASE}/users/@me/lists/%40default`, `${BASE}/users/@me/lists/a%2Fb%20c`]);
  });

  it('propagates GoogleNotFoundError', async () => {
    const { service } = serviceWith(() => json({ error: { code: 404, message: 'gone' } }, 404));

    const result = await service.getTaskList({ taskListId: 'nope' });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});

describe('createTaskList', () => {
  it('POSTs the title to users/@me/lists and returns the new list', async () => {
    const { service, calls } = serviceWith(() => json(wireTaskList));

    const result = await service.createTaskList({ title: 'Work' });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.url).toBe(`${BASE}/users/@me/lists`);
    expect(bodyOf(calls[0])).toStrictEqual({ title: 'Work' });
    expect(result._unsafeUnwrap()).toStrictEqual(normalizedTaskList);
  });

  it.each(['', '   ', '　\n'])('rejects the blank title %j without calling Google', async (title) => {
    const { service, calls } = neverCalledList();

    const result = await service.createTaskList({ title });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain(`"${title}"`);
    expect(error.message).toContain('task list title');
    expect(error.message).toContain('non-empty');
    expect(calls).toHaveLength(0);
  });

  it('rejects a title longer than 1024 characters without calling Google', async () => {
    const { service, calls } = neverCalledList();

    const result = await service.createTaskList({ title: 'x'.repeat(1025) });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('1025');
    expect(error.message).toContain('1024');
    expect(calls).toHaveLength(0);
  });

  it('accepts a title of exactly 1024 characters', async () => {
    const { service } = serviceWith(() => json(wireTaskList));

    expect((await service.createTaskList({ title: 'x'.repeat(1024) })).isOk()).toBe(true);
  });
});

describe('renameTaskList', () => {
  it('PATCHes only the title of users/@me/lists/{id} and returns the renamed list', async () => {
    const { service, calls } = serviceWith(() => json(wireTaskList));

    const result = await service.renameTaskList({ taskListId: 'L1', title: 'Work' });

    expect(calls[0]?.init?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe(`${BASE}/users/@me/lists/L1`);
    expect(bodyOf(calls[0])).toStrictEqual({ title: 'Work' });
    expect(result._unsafeUnwrap()).toStrictEqual(normalizedTaskList);
  });

  it('accepts @default and URL-encodes the id', async () => {
    const { service, calls } = serviceWith(() => json(wireTaskList));

    await service.renameTaskList({ taskListId: '@default', title: 'Inbox' });

    expect(calls[0]?.url).toBe(`${BASE}/users/@me/lists/%40default`);
  });

  it('rejects a blank title without calling Google', async () => {
    const { service, calls } = neverCalledList();

    const result = await service.renameTaskList({ taskListId: 'L1', title: ' ' });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('task list title');
    expect(calls).toHaveLength(0);
  });

  it('propagates GoogleNotFoundError', async () => {
    const { service } = serviceWith(() => json({ error: { code: 404, message: 'gone' } }, 404));

    const result = await service.renameTaskList({ taskListId: 'nope', title: 'x' });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});

describe('deleteTaskList', () => {
  it('DELETEs users/@me/lists/{id} and resolves to undefined on 204', async () => {
    const { service, calls } = serviceWith(() => new Response(null, { status: 204 }));

    const result = await service.deleteTaskList({ taskListId: 'a/b' });

    expect(calls[0]?.init?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(`${BASE}/users/@me/lists/a%2Fb`);
    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it('rejects @default without calling Google: the default list cannot be deleted', async () => {
    const { service, calls } = neverCalledList();

    const result = await service.deleteTaskList({ taskListId: '@default' });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('"@default"');
    expect(error.message).toContain('default task list cannot be deleted');
    expect(error.message).toContain('id of another task list');
    expect(calls).toHaveLength(0);
  });

  it.each(['', ' \t'])('rejects the blank id %j without calling Google', async (taskListId) => {
    const { service, calls } = neverCalledList();

    const result = await service.deleteTaskList({ taskListId });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain(`"${taskListId}"`);
    expect(error.message).toContain('id or title');
    expect(calls).toHaveLength(0);
  });

  it('propagates GoogleNotFoundError', async () => {
    const { service } = serviceWith(() => json({ error: { code: 404, message: 'gone' } }, 404));

    const result = await service.deleteTaskList({ taskListId: 'nope' });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});

const top = { kind: 'root', position: { kind: 'first' } } as const;

describe('moveTask', () => {
  it('POSTs tasks/{id}/move with no body and no query to move a task to the top of its own list', async () => {
    const { service, calls } = serviceWith(() => json(wireTask));

    const result = await service.moveTask({ taskId: 'T1', destination: { kind: 'sameList' }, placement: top });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.url).toBe(`${BASE}/lists/%40default/tasks/T1/move`);
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(result._unsafeUnwrap()).toStrictEqual(normalizedTask);
  });

  it.each([
    ['after a sibling at the top level', { kind: 'root', position: { kind: 'after', previousId: 'S0' } }, { parent: null, previous: 'S0' }],
    ['as the first subtask of a parent', { kind: 'subtask', parentId: 'P1', position: { kind: 'first' } }, { parent: 'P1', previous: null }],
    ['as a subtask after a sibling', { kind: 'subtask', parentId: 'P1', position: { kind: 'after', previousId: 'S0' } }, { parent: 'P1', previous: 'S0' }],
  ] as const)('places the task %s via parent / previous', async (_label, placement, expected) => {
    const { service, calls } = serviceWith(() => json(wireTask));

    await service.moveTask({ taskListId: 'L1', taskId: 'T1', destination: { kind: 'sameList' }, placement });

    const url = urlOf(calls[0]);
    expect(url.pathname).toBe('/tasks/v1/lists/L1/tasks/T1/move');
    expect(url.searchParams.get('parent')).toBe(expected.parent);
    expect(url.searchParams.get('previous')).toBe(expected.previous);
    expect(url.searchParams.has('destinationTasklist')).toBe(false);
  });

  it('moves the task to another list with destinationTasklist and reports the destination list', async () => {
    const { service, calls } = serviceWith(() => json({ ...wireTask, id: 'T1' }));

    const result = await service.moveTask({
      taskListId: 'L1',
      taskId: 'T1',
      destination: { kind: 'otherList', taskListId: 'L2' },
      placement: { kind: 'subtask', parentId: 'P9', position: { kind: 'first' } },
    });

    const url = urlOf(calls[0]);
    expect(url.pathname).toBe('/tasks/v1/lists/L1/tasks/T1/move');
    expect(url.searchParams.get('destinationTasklist')).toBe('L2');
    expect(url.searchParams.get('parent')).toBe('P9');
    expect(result._unsafeUnwrap()).toMatchObject({ id: 'T1', taskListId: 'L2' });
  });

  it.each([
    ['parentId', { kind: 'subtask', parentId: 'T1', position: { kind: 'first' } }],
    ['previousId', { kind: 'root', position: { kind: 'after', previousId: 'T1' } }],
    ['previousId', { kind: 'subtask', parentId: 'P1', position: { kind: 'after', previousId: 'T1' } }],
  ] as const)('rejects the task itself as %s without calling Google', async (field, placement) => {
    const { service, calls } = neverCalled();

    const result = await service.moveTask({ taskId: 'T1', destination: { kind: 'sameList' }, placement });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain(field);
    expect(error.message).toContain('"T1"');
    expect(calls).toHaveLength(0);
  });

  it.each(['', '  '])('rejects the blank destination list %j without calling Google', async (taskListId) => {
    const { service, calls } = neverCalled();

    const result = await service.moveTask({ taskId: 'T1', destination: { kind: 'otherList', taskListId }, placement: top });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('destination');
    expect(calls).toHaveLength(0);
  });

  it('propagates GoogleNotFoundError', async () => {
    const { service } = serviceWith(() => json({ error: { code: 404, message: 'gone' } }, 404));

    const result = await service.moveTask({ taskId: 'T1', destination: { kind: 'sameList' }, placement: top });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});

describe('clearCompletedTasks', () => {
  it('POSTs lists/{id}/clear with no body and resolves to undefined on 204', async () => {
    const { service, calls } = serviceWith(() => new Response(null, { status: 204 }));

    const result = await service.clearCompletedTasks({ taskListId: 'a/b' });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.url).toBe(`${BASE}/lists/a%2Fb/clear`);
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it('accepts @default and an empty 200 answer', async () => {
    const { service, calls } = serviceWith(() => new Response('', { status: 200 }));

    const result = await service.clearCompletedTasks({ taskListId: '@default' });

    expect(calls[0]?.url).toBe(`${BASE}/lists/%40default/clear`);
    expect(result.isOk()).toBe(true);
  });

  it.each(['', ' \t'])('rejects the blank list %j without calling Google', async (taskListId) => {
    const { service, calls } = neverCalledList();

    const result = await service.clearCompletedTasks({ taskListId });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain(`"${taskListId}"`);
    expect(calls).toHaveLength(0);
  });

  it('propagates GoogleNotFoundError', async () => {
    const { service } = serviceWith(() => json({ error: { code: 404, message: 'gone' } }, 404));

    const result = await service.clearCompletedTasks({ taskListId: 'nope' });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});
