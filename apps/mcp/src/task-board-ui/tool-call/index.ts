import type { PendingOp } from '../board-state';
import type { ServerToolName } from '../tool-name';

export type ToolCall = { readonly name: ServerToolName; readonly args: Readonly<Record<string, string>> };

// move_task args. A subtask always names its parent: without `parentId` the server would un-nest it.
const moveArgs = (op: Extract<PendingOp, { kind: 'reorder' }>): Readonly<Record<string, string>> => ({
  taskId: op.taskId,
  list: op.taskListId,
  ...(op.parent.kind === 'subtask' ? { parentId: op.parent.parentId } : {}),
  ...(op.placement.kind === 'after' ? { previousId: op.placement.previousId } : {}),
});

export const toolCallFor = (op: PendingOp): ToolCall => {
  switch (op.kind) {
    case 'status':
      return { name: 'set_task_status', args: { taskId: op.taskId, list: op.taskListId, status: op.to } };
    case 'reorder':
      return { name: 'move_task', args: moveArgs(op) };
    default: {
      const _exhaustive: never = op;
      throw new Error(`unhandled op: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
