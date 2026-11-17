import { describe, expect, it } from 'vitest';

import { BOARD_TOOL_NAME, serverToolName } from './index';

describe('serverToolName', () => {
  it('uses the bare name when the host called show_task_board by its own name', () => {
    expect(serverToolName(BOARD_TOOL_NAME, 'list_tasks')).toBe('list_tasks');
  });

  it("keeps a proxy's prefix (e.g. an MCP portal that namespaces tools per server)", () => {
    expect(serverToolName('gct_show_task_board', 'set_task_status')).toBe('gct_set_task_status');
    expect(serverToolName('gct-stg__show_task_board', 'move_task')).toBe('gct-stg__move_task');
  });

  it('falls back to the bare name when the host did not say which tool opened the board, or renamed it some other way', () => {
    expect(serverToolName(undefined, 'list_tasks')).toBe('list_tasks');
    expect(serverToolName('board', 'list_tasks')).toBe('list_tasks');
  });
});
