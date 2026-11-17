import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { readRPCBody, toolText } from '../../test-support';
import { MCP_TOOL_NAMES, serveMCP } from './index';

import type { ToolDeps } from '../tool-deps';
import type { ICalendarService } from '@napolab/gct-core/calendar';
import type { ITasksService } from '@napolab/gct-core/tasks';

const unexpected = () => {
  throw new Error('unexpected call');
};

const calendar: ICalendarService = {
  listCalendars: () => okAsync([]),
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

const tasks: ITasksService = {
  listTaskLists: unexpected,
  listTasks: unexpected,
  getTask: unexpected,
  createTask: unexpected,
  updateTask: unexpected,
  completeTask: unexpected,
  reopenTask: unexpected,
  deleteTask: unexpected,
  getTaskList: unexpected,
  createTaskList: unexpected,
  renameTaskList: unexpected,
  deleteTaskList: unexpected,
  moveTask: unexpected,
  clearCompletedTasks: unexpected,
};

const deps: ToolDeps = { services: { calendar, tasks }, now: () => 0, connectURL: 'https://gct.example.com/google/connect' };

const assets = { taskBoard: { html: '<!doctype html><title>board</title>' } };

const rpc = (body: unknown) =>
  new Request('https://gct.example.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify(body),
  });

const call = async (body: unknown) => {
  const response = await serveMCP(rpc(body), deps, assets);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/application\/json/);
  return readRPCBody(response);
};

describe('serveMCP', () => {
  it('answers initialize as the gct server', async () => {
    const body = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });

    expect(body).toMatchObject({ id: 1, result: { serverInfo: { name: 'gct' } } });
  });

  it('lists every calendar and tasks tool', async () => {
    const body = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect((body.result.tools ?? []).map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect(new Set(MCP_TOOL_NAMES).size).toBe(MCP_TOOL_NAMES.length);
    expect(MCP_TOOL_NAMES).toEqual(expect.arrayContaining(['get_task', 'move_task', 'clear_completed_tasks', 'get_task_list', 'set_task_status', 'show_task_board']));
  });

  it('serves the task board MCP App resource it was given', async () => {
    const response = await serveMCP(rpc({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'ui://gct/task-board.html' } }), deps, assets);
    const body: unknown = await response.json();

    expect(body).toMatchObject({ result: { contents: [{ uri: 'ui://gct/task-board.html', mimeType: 'text/html;profile=mcp-app', text: assets.taskBoard.html }] } });
  });

  it("rejects create_task status 'done' and lists the allowed values", async () => {
    const body = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'x', status: 'done' } } });

    expect(body.result.isError).toBe(true);
    expect(toolText(body)).toMatch(/todo.*doing/);
  });

  it('calls a tool and returns its JSON text', async () => {
    const body = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_calendars', arguments: {} } });

    expect(body.result.isError).toBeUndefined();
    expect(JSON.parse(toolText(body))).toEqual({ calendars: [] });
  });

  it('returns isError for arguments the schema rejects (unknown key on a write tool)', async () => {
    const body = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'x', due_date: '2026-11-20' } } });

    expect(body.result.isError).toBe(true);
    expect(toolText(body)).toContain('due_date');
  });

  it('returns isError with the write-strict message for a malformed value', async () => {
    const body = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'x', due: '20 Nov' } } });

    expect(body.result.isError).toBe(true);
    expect(toolText(body)).toContain('YYYY-MM-DD');
  });
});
