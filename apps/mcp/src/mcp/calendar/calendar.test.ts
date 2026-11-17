import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MCP_TOOL_NAMES, serveMCP } from '../server';
import { depsWith } from './test-support';

// Every calendar tool, with the annotation preset it must carry.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const ADDITIVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const IDEMPOTENT_UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

const CALENDAR_TOOLS = {
  list_calendars: READ_ONLY,
  list_events: READ_ONLY,
  list_event_instances: READ_ONLY,
  get_event: READ_ONLY,
  create_event: ADDITIVE,
  quick_add_event: ADDITIVE,
  import_event: ADDITIVE,
  update_event: IDEMPOTENT_UPDATE,
  move_event: ADDITIVE,
  delete_event: DESTRUCTIVE,
  query_freebusy: READ_ONLY,
  get_calendar: READ_ONLY,
  create_calendar: ADDITIVE,
  update_calendar: IDEMPOTENT_UPDATE,
  delete_calendar: DESTRUCTIVE,
  clear_calendar: DESTRUCTIVE,
  get_calendar_list_entry: READ_ONLY,
  subscribe_calendar: IDEMPOTENT_UPDATE,
  update_calendar_list_entry: IDEMPOTENT_UPDATE,
  unsubscribe_calendar: DESTRUCTIVE,
  list_calendar_acl: READ_ONLY,
  get_calendar_acl_rule: READ_ONLY,
  share_calendar: ADDITIVE,
  update_calendar_acl_rule: DESTRUCTIVE,
  unshare_calendar: DESTRUCTIVE,
  get_colors: READ_ONLY,
  list_settings: READ_ONLY,
  get_setting: READ_ONLY,
} as const;

const toolsSchema = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        annotations: z.object({ readOnlyHint: z.boolean().optional(), destructiveHint: z.boolean().optional(), idempotentHint: z.boolean().optional() }).optional(),
      }),
    ),
  }),
});

const rpc = (body: unknown): Request =>
  new Request('https://gct.example.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify(body),
  });

const ASSETS = { taskBoard: { html: '' } };

const callResultSchema = z.object({ result: z.object({ isError: z.boolean().optional(), content: z.array(z.object({ text: z.string() })) }) });

const listTools = async () => {
  const response = await serveMCP(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }), depsWith({}), ASSETS);
  return toolsSchema.parse(await response.json()).result.tools;
};

describe('calendar tool registration', () => {
  it('lists every calendar tool in MCP_TOOL_NAMES', () => {
    expect(MCP_TOOL_NAMES).toEqual(expect.arrayContaining(Object.keys(CALENDAR_TOOLS)));
  });

  it.each(Object.entries(CALENDAR_TOOLS))('registers %s with its read-only / destructive / idempotent hints', async (name, annotations) => {
    const tool = (await listTools()).find((candidate) => candidate.name === name);

    expect(tool?.annotations).toEqual(annotations);
  });

  it.each(['create_event', 'update_event', 'delete_event', 'move_event', 'quick_add_event'])('%s says guests are only emailed when asked', async (name) => {
    const tool = (await listTools()).find((candidate) => candidate.name === name);

    expect(tool?.description).toContain('NOT emailed unless sendUpdates');
  });

  it.each(['share_calendar', 'update_calendar_acl_rule', 'unshare_calendar'])('%s is described as sensitive', async (name) => {
    const tool = (await listTools()).find((candidate) => candidate.name === name);

    expect(tool?.description).toContain('SENSITIVE');
  });
});

describe('clear_calendar confirmation', () => {
  it.each([[{}], [{ confirm: 'yes' }], [{ confirm: 'delete-all-events', calendarId: 'c1' }]])('refuses %o without touching Google', async (args) => {
    const calls: unknown[] = [];
    const deps = depsWith({ clearPrimaryCalendar: () => (calls.push('clear'), okAsync(undefined)) });

    const response = await serveMCP(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'clear_calendar', arguments: args } }), deps, ASSETS);
    const body = callResultSchema.parse(await response.json());

    expect(body.result.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("clears only with confirm: 'delete-all-events'", async () => {
    const calls: unknown[] = [];
    const deps = depsWith({ clearPrimaryCalendar: () => (calls.push('clear'), okAsync(undefined)) });

    const response = await serveMCP(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'clear_calendar', arguments: { confirm: 'delete-all-events' } } }), deps, ASSETS);

    expect(callResultSchema.parse(await response.json()).result.isError).toBeUndefined();
    expect(calls).toEqual(['clear']);
  });
});
