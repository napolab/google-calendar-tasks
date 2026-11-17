import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';

import { registerCalendarTools } from '../calendar';
import { registerTasksTools } from '../tasks';

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
] as const;

// The JSON Schema validator is injected explicitly: the SDK's default is chosen by build-time export conditions and
// may resolve to Ajv, which compiles schemas with `new Function` — forbidden on Workers.
export const createMCPServer = (deps: ToolDeps): McpServer => {
  const server = new McpServer({ name: 'gct', version: '0.1.0' }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  registerCalendarTools(server, deps);
  registerTasksTools(server, deps);
  return server;
};

// Stateless Streamable HTTP: a fresh server + transport per request (sharing one throws "already connected"),
// plain JSON responses instead of SSE.
export const serveMCP = async (request: Request, deps: ToolDeps): Promise<Response> => {
  const server = createMCPServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
};
