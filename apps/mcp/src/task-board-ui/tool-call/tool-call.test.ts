import { describe, expect, it } from 'vitest';

import { toolCallFor } from './index';

import type { PendingOp } from '../board-state';

describe('toolCallFor', () => {
  it('sets a task’s status', () => {
    const op: PendingOp = { id: 1, kind: 'status', taskId: 'b', taskListId: 'work', to: 'doing' };

    expect(toolCallFor(op)).toEqual({ name: 'set_task_status', args: { taskId: 'b', list: 'work', status: 'doing' } });
  });

  it('moves a top-level task without parentId', () => {
    const base = { id: 1, kind: 'reorder', taskId: 'a', taskListId: 'work', parent: { kind: 'root' } } as const;

    expect(toolCallFor({ ...base, placement: { kind: 'after', previousId: 'c' } })).toEqual({ name: 'move_task', args: { taskId: 'a', list: 'work', previousId: 'c' } });
    expect(toolCallFor({ ...base, placement: { kind: 'first' } })).toEqual({ name: 'move_task', args: { taskId: 'a', list: 'work' } });
  });

  it('keeps a subtask under its parent', () => {
    const base = { id: 1, kind: 'reorder', taskId: 'a2', taskListId: 'work', parent: { kind: 'subtask', parentId: 'a' } } as const;

    expect(toolCallFor({ ...base, placement: { kind: 'first' } })).toEqual({ name: 'move_task', args: { taskId: 'a2', list: 'work', parentId: 'a' } });
    expect(toolCallFor({ ...base, placement: { kind: 'after', previousId: 'a1' } })).toEqual({
      name: 'move_task',
      args: { taskId: 'a2', list: 'work', parentId: 'a', previousId: 'a1' },
    });
  });
});
