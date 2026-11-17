import { GoogleAPIError } from '@napolab/gct-core/errors';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TASK_BOARD_RESOURCE_URI, registerTaskBoardApp } from './index';

import type { ToolDeps } from '../tool-deps';
import type { ICalendarService } from '@napolab/gct-core/calendar';
import type { ITasksService, Task, TaskListSummary } from '@napolab/gct-core/tasks';

const HTML = '<!doctype html><title>board</title>';

const LISTS: TaskListSummary[] = [
  { id: 'l-default', title: 'My Tasks', updated: 'u' },
  { id: 'l-work', title: 'Work', updated: 'u' },
];

const task = (taskListId: string, id: string, notes: string): Task => ({
  status: 'needsAction',
  id,
  taskListId,
  title: `Task ${id}`,
  notes,
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

const unexpected = (): never => {
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

// Reads only: every write throws, so the board tool is proven read-only.
const tasks: ITasksService = {
  listTaskLists: () => okAsync(LISTS),
  getTaskList: (input) => {
    const list = LISTS.find((candidate) => candidate.id === (input.taskListId === '@default' ? 'l-default' : input.taskListId));
    return list === undefined ? errAsync(new GoogleAPIError('Google API 400: Invalid task list ID', 400)) : okAsync(list);
  },
  listTasks: (input) => okAsync({ items: [task(input.taskListId ?? '@default', `${input.taskListId ?? ''}-1`, '[status: doing]\nbody')], next: { kind: 'last' } }),
  getTask: unexpected,
  createTask: unexpected,
  updateTask: unexpected,
  completeTask: unexpected,
  reopenTask: unexpected,
  deleteTask: unexpected,
  moveTask: unexpected,
  clearCompletedTasks: unexpected,
  createTaskList: unexpected,
  renameTaskList: unexpected,
  deleteTaskList: unexpected,
};

const deps: ToolDeps = { services: { calendar, tasks }, now: () => 0, connectURL: 'https://gct.example.com/google/connect', defaultTaskList: '日常タスク' };

const rpc = async (method: string, params: unknown): Promise<unknown> => {
  const server = new McpServer({ name: 'test', version: '0' }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  registerTaskBoardApp(server, deps, { html: HTML });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(
    new Request('https://gct.example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  return z.object({ result: z.unknown() }).parse(await response.json()).result;
};

const uiMetaSchema = z.object({ prefersBorder: z.boolean(), csp: z.object({}).passthrough() });

const toolsSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      annotations: z.object({ readOnlyHint: z.boolean() }).passthrough(),
      _meta: z.object({ ui: z.object({ resourceUri: z.string() }), 'ui/resourceUri': z.string() }),
    }),
  ),
});

const resourcesSchema = z.object({ resources: z.array(z.object({ uri: z.string(), name: z.string(), mimeType: z.string(), _meta: z.object({ ui: uiMetaSchema }) })) });

const readSchema = z.object({ contents: z.array(z.object({ uri: z.string(), mimeType: z.string(), text: z.string(), _meta: z.object({ ui: uiMetaSchema }) })) });

const callSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  structuredContent: z
    .object({
      selection: z.discriminatedUnion('kind', [z.object({ kind: z.literal('all') }), z.object({ kind: z.literal('list'), taskListId: z.string() })]),
      lists: z.array(z.object({ taskListId: z.string(), title: z.string(), tasks: z.array(z.object({ id: z.string(), boardStatus: z.string(), body: z.string() })) })),
    })
    .optional(),
});

const callBoard = async (args: unknown) => callSchema.parse(await rpc('tools/call', { name: 'show_task_board', arguments: args }));

describe('show_task_board (MCP App)', () => {
  it('is a read-only tool linked to the board UI resource', async () => {
    const { tools } = toolsSchema.parse(await rpc('tools/list', {}));

    expect(tools.map((tool) => tool.name)).toEqual(['show_task_board']);
    expect(tools[0]).toMatchObject({ annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: TASK_BOARD_RESOURCE_URI }, 'ui/resourceUri': TASK_BOARD_RESOURCE_URI } });
    expect(TASK_BOARD_RESOURCE_URI).toMatch(/^ui:\/\//);
  });

  it('lists the UI resource as an MCP App HTML resource', async () => {
    const { resources } = resourcesSchema.parse(await rpc('resources/list', {}));

    expect(resources).toEqual([expect.objectContaining({ uri: TASK_BOARD_RESOURCE_URI, mimeType: 'text/html;profile=mcp-app' })]);
  });

  it('serves the injected HTML with the MCP App mime type, a border and no external origins', async () => {
    const { contents } = readSchema.parse(await rpc('resources/read', { uri: TASK_BOARD_RESOURCE_URI }));

    expect(contents).toEqual([{ uri: TASK_BOARD_RESOURCE_URI, mimeType: 'text/html;profile=mcp-app', text: HTML, _meta: { ui: { prefersBorder: true, csp: {} } } }]);
  });

  it('returns every list with its tasks (board status derived) for the UI, and the same data as text', async () => {
    const result = await callBoard({});

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      selection: { kind: 'all' },
      lists: [
        expect.objectContaining({ taskListId: 'l-default', title: 'My Tasks', tasks: [expect.objectContaining({ id: 'l-default-1', boardStatus: 'doing', body: 'body' })] }),
        expect.objectContaining({ taskListId: 'l-work', title: 'Work' }),
      ],
    });
    expect(callSchema.shape.structuredContent.parse(JSON.parse(result.content[0]?.text ?? ''))).toEqual(result.structuredContent);
  });

  it('preselects a list named by title, id or @default', async () => {
    expect((await callBoard({ list: 'work' })).structuredContent?.selection).toEqual({ kind: 'list', taskListId: 'l-work' });
    expect((await callBoard({ list: 'l-work' })).structuredContent?.selection).toEqual({ kind: 'list', taskListId: 'l-work' });
    expect((await callBoard({ list: '@default' })).structuredContent?.selection).toEqual({ kind: 'list', taskListId: 'l-default' });
  });

  it('names the available lists when the preselected list does not exist', async () => {
    const result = await callBoard({ list: 'Nope' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Work');
  });
});
