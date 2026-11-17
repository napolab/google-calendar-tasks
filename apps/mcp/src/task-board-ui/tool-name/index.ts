// Tool names as the host knows them. A proxy in front of this server (e.g. an MCP portal) may namespace every tool with
// a prefix; the host reports the name it used for the tool that opened the board (hostContext.toolInfo.tool.name), so
// the same prefix goes in front of the tools the board calls.

export const BOARD_TOOL_NAME = 'show_task_board';

export type ServerToolName = 'list_tasks' | 'set_task_status' | 'move_task';

const prefixOf = (hostBoardToolName: string | undefined): string =>
  hostBoardToolName !== undefined && hostBoardToolName.endsWith(BOARD_TOOL_NAME) ? hostBoardToolName.slice(0, hostBoardToolName.length - BOARD_TOOL_NAME.length) : '';

export const serverToolName = (hostBoardToolName: string | undefined, name: ServerToolName): string => `${prefixOf(hostBoardToolName)}${name}`;
