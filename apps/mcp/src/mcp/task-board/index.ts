import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { okAsync } from 'neverthrow';
import { z } from 'zod';

import { toGetTaskListTarget } from '../tasks/input';
import { readTasksListing, resolveListSummary } from '../tasks';
import { toToolError } from '../tool-result';

import type { TasksListing } from '../tasks';
import type { ToolDeps } from '../tool-deps';
import type { ToolError } from '../tool-result';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ITasksService } from '@napolab/gct-core/tasks';
import type { ResultAsync } from 'neverthrow';

// Google Tasks kanban board as an MCP App (io.modelcontextprotocol/ui): `show_task_board` declares the `ui://` HTML
// resource in `_meta.ui.resourceUri`; a host that supports MCP Apps renders that resource in a sandboxed iframe and
// hands it this tool's result. The board then calls list_tasks / set_task_status / move_task through the host bridge.
// Hosts without MCP Apps just get the JSON text. The server is stateless per request, so the tool is always registered
// (no getUiCapability gating: client capabilities from `initialize` are not available on later requests).

export const TASK_BOARD_RESOURCE_URI = 'ui://gct/task-board.html';

// The bundled single-file board UI, built by the Vite plugin (vite/task-board-ui.ts) and injected by the entrypoint.
export type TaskBoardAssets = { readonly html: string };

// Read on resources/read (the content item, which hosts prefer) and resources/list: a bordered card, and an empty CSP —
// the HTML inlines its JS / CSS and talks only to the host, so it needs no external origin.
const UI_META = { ui: { prefersBorder: true, csp: {} } };

export const showTaskBoardArgs = z.strictObject({
  list: z.string().min(1).optional().describe("Preselect this task list (an id or a title from list_task_lists, or '@default'). Default: every list."),
});

export type ShowTaskBoardArgs = z.output<typeof showTaskBoardArgs>;

// Which list the board opens on. Every list is always sent, so the user can switch without another call.
export type TaskBoardSelection = { readonly kind: 'all' } | { readonly kind: 'list'; readonly taskListId: string };

export type TaskBoardPayload = TasksListing & { readonly selection: TaskBoardSelection };

const selectionFor = (tasks: ITasksService, args: ShowTaskBoardArgs): ResultAsync<TaskBoardSelection, ToolError> =>
  args.list === undefined ? okAsync({ kind: 'all' }) : resolveListSummary(tasks, toGetTaskListTarget({ list: args.list })).map((list): TaskBoardSelection => ({ kind: 'list', taskListId: list.id }));

const readBoard = (tasks: ITasksService, args: ShowTaskBoardArgs): ResultAsync<TaskBoardPayload, ToolError> =>
  selectionFor(tasks, args).andThen((selection) => readTasksListing(tasks, {}).map((listing): TaskBoardPayload => ({ ...listing, selection })));

const DESCRIPTION =
  "Show the user's Google Tasks as an interactive kanban board (columns todo / doing / done from each task's '[status: …]' notes tag and completion; subtasks nested in their parent card). The user can drag cards between columns, reorder them and tick them off in the board. Use it when the user wants to see or organize their tasks visually. Returns every list with its tasks (the list_tasks shape) plus the preselected list. Adding, editing or deleting tasks is done with the other tools.";

export const registerTaskBoardApp = (server: McpServer, deps: ToolDeps, assets: TaskBoardAssets): void => {
  const { tasks } = deps.services;
  const fail = toToolError(deps.connectURL, 'tasks');

  registerAppTool(
    server,
    'show_task_board',
    {
      title: 'Show task board',
      description: DESCRIPTION,
      inputSchema: showTaskBoardArgs,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: TASK_BOARD_RESOURCE_URI } },
    },
    async (args: ShowTaskBoardArgs) => readBoard(tasks, args).match((payload) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }], structuredContent: payload }), fail),
  );

  registerAppResource(server, 'Task board', TASK_BOARD_RESOURCE_URI, { description: 'Kanban board UI for show_task_board.', mimeType: RESOURCE_MIME_TYPE, _meta: UI_META }, async () => ({
    contents: [{ uri: TASK_BOARD_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: assets.html, _meta: UI_META }],
  }));
};
