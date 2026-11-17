import { describe, expect, it } from 'vitest';

import { toSendUpdates } from '../calendar/shared';
import { MCP_TOOL_NAMES } from '../server';
import { TOOL_TIME_ZONE } from '../time-input';
import { buildServerInstructions } from './index';

const instructions = buildServerInstructions({ defaultTaskList: '日常タスク', timeZone: TOOL_TIME_ZONE });

describe('buildServerInstructions', () => {
  it('tells the LLM to use the tools time zone, with an offset example derived from it', () => {
    expect(instructions).toContain('Asia/Tokyo');
    expect(instructions).toContain('+09:00');
    expect(instructions).toContain('YYYY-MM-DD');
  });

  it('derives the offset example from the zone it is given', () => {
    const kolkata = buildServerInstructions({ defaultTaskList: '日常タスク', timeZone: 'Asia/Kolkata' });

    expect(kolkata).toContain('Asia/Kolkata');
    expect(kolkata).toContain('2026-11-17T10:00:00+05:30');
    expect(kolkata).not.toContain('+09:00');
  });

  it('tells the LLM to leave sendUpdates unset, which the calendar tools read as no email', () => {
    expect(instructions).toContain('sendUpdates');
    expect(instructions).toMatch(/explicitly asks/);
    expect(toSendUpdates(undefined)).toBe('none');
  });

  it('names the configured default task list and keeps list_tasks / show_task_board on every list', () => {
    expect(instructions).toContain('"日常タスク"');
    expect(buildServerInstructions({ defaultTaskList: 'Inbox', timeZone: TOOL_TIME_ZONE })).toContain('"Inbox"');
    expect(instructions).toMatch(/list_tasks and show_task_board without list cover EVERY list/);
    expect(instructions).toContain('taskListId');
  });

  it('only names tools the server registers', () => {
    const named = instructions.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];

    expect(named.length).toBeGreaterThan(0);
    expect(MCP_TOOL_NAMES).toEqual(expect.arrayContaining(named));
  });
});
