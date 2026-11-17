import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';

import { registerCalendarTools } from '../calendar';
import { buildServerInstructions } from '../server-instructions';
import { registerTaskBoardApp } from '../task-board';
import { registerTasksTools } from '../tasks';
import { TOOL_TIME_ZONE } from '../time-input';

import type { TaskBoardAssets } from '../task-board';
import type { ToolDeps } from '../tool-deps';

// The tools this server registers (asserted against tools/list in the test).
export const MCP_TOOL_NAMES = [
  'list_calendars',
  'list_events',
  'get_event',
  'create_event',
  'update_event',
  'delete_event',
  'query_freebusy',
  'list_task_lists',
  'list_tasks',
  'create_task',
  'update_task',
  'complete_task',
  'reopen_task',
  'delete_task',
  'create_task_list',
  'rename_task_list',
  'delete_task_list',
  'get_task',
  'move_task',
  'clear_completed_tasks',
  'get_task_list',
  'list_event_instances',
  'move_event',
  'quick_add_event',
  'import_event',
  'get_calendar',
  'create_calendar',
  'update_calendar',
  'delete_calendar',
  'clear_calendar',
  'get_calendar_list_entry',
  'subscribe_calendar',
  'update_calendar_list_entry',
  'unsubscribe_calendar',
  'list_calendar_acl',
  'get_calendar_acl_rule',
  'share_calendar',
  'update_calendar_acl_rule',
  'unshare_calendar',
  'get_colors',
  'list_settings',
  'get_setting',
  'set_task_status',
  // MCP App (ui://gct/task-board.html)
  'show_task_board',
] as const;

// Bundled MCP App UIs (isolate lifetime: built into the Worker, injected by the entrypoint).
export type McpAppAssets = { readonly taskBoard: TaskBoardAssets };

// The JSON Schema validator is injected explicitly: the SDK's default is chosen by build-time export conditions and
// may resolve to Ajv, which compiles schemas with `new Function` — forbidden on Workers. `instructions` (sent in the
// initialize result) states the defaults the tools apply: time zone, no guest emails, the default task list.
export const createMCPServer = (deps: ToolDeps, assets: McpAppAssets): McpServer => {
  const server = new McpServer(
    { name: 'gct', version: '0.1.0' },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator(), instructions: buildServerInstructions({ defaultTaskList: deps.defaultTaskList, timeZone: TOOL_TIME_ZONE }) },
  );
  registerCalendarTools(server, deps);
  registerTasksTools(server, deps);
  registerTaskBoardApp(server, deps, assets.taskBoard);
  return server;
};

// Stateless Streamable HTTP: a fresh server + transport per request (sharing one throws "already connected"),
// plain JSON responses instead of SSE.
export const serveMCP = async (request: Request, deps: ToolDeps, assets: McpAppAssets): Promise<Response> => {
  const server = createMCPServer(deps, assets);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
};
