import type { BoardCard, BoardColumn } from '../board';
import type { BoardStatus, TaskItem } from '../wire';

// Drag & drop / keyboard moves → the tool call they mean. Reorder maps to move_task (always among the card's siblings:
// the top-level cards of its own list, or the subtasks of its own parent); a column change maps to set_task_status.

// move_task's placement among the siblings: right after a sibling, or first.
export type Placement = { readonly kind: 'first' } | { readonly kind: 'after'; readonly previousId: string };

// otherList: a top-level card dropped where it has no top-level neighbour of its own list (all-lists view, or among subtask cards).
// otherParent: a subtask dropped where it has no neighbour with the same parent.
// locked: the done column, or an orphan subtask (move_task without parentId would un-nest it).
export type RejectReason = 'otherList' | 'otherParent' | 'locked';

export type ReorderPlan =
  | { readonly kind: 'move'; readonly taskId: string; readonly taskListId: string; readonly parent: TaskItem['parent']; readonly placement: Placement }
  | { readonly kind: 'noop' }
  | { readonly kind: 'rejected'; readonly reason: RejectReason };

export type StatusPlan = { readonly kind: 'status'; readonly taskId: string; readonly taskListId: string; readonly to: BoardStatus } | { readonly kind: 'noop' };

// Same list and same parent: two root cards of a list, or two subtask cards with the same parentId. Orphans have no sibling.
export const isSibling = (a: BoardCard, b: BoardCard): boolean => {
  if (a.task.taskListId !== b.task.taskListId) return false;
  switch (a.nesting.kind) {
    case 'root':
      return b.nesting.kind === 'root';
    case 'subtask':
      return b.nesting.kind === 'subtask' && b.nesting.parentId === a.nesting.parentId;
    case 'orphan':
      return false;
    default: {
      const _exhaustive: never = a.nesting;
      throw new Error(`unhandled nesting: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const rejectionFor = (dragged: BoardCard): RejectReason => (dragged.nesting.kind === 'subtask' ? 'otherParent' : 'otherList');

// `targetIndex` is the drop point among the column's cards as shown, counted with the dragged card still in place
// (0 = above the first card, cards.length = below the last).
export const planReorder = (column: BoardColumn, taskId: string, targetIndex: number): ReorderPlan => {
  const from = column.cards.findIndex((card) => card.task.id === taskId);
  const dragged = column.cards[from];
  if (dragged === undefined) return { kind: 'noop' };
  if (column.status === 'done' || dragged.nesting.kind === 'orphan') return { kind: 'rejected', reason: 'locked' };

  const index = targetIndex > from ? targetIndex - 1 : targetIndex;
  if (index === from) return { kind: 'noop' };

  const others = column.cards.filter((card) => card.task.id !== taskId);
  const siblingOfDragged = (card: BoardCard | undefined): boolean => card !== undefined && isSibling(dragged, card);
  if (!siblingOfDragged(others[index - 1]) && !siblingOfDragged(others[index])) return { kind: 'rejected', reason: rejectionFor(dragged) };

  const previous = others.slice(0, index).filter(siblingOfDragged).at(-1);
  return {
    kind: 'move',
    taskId,
    taskListId: dragged.task.taskListId,
    parent: dragged.task.parent,
    placement: previous === undefined ? { kind: 'first' } : { kind: 'after', previousId: previous.task.id },
  };
};

// The drop point a "move up / down" button means: above the nearest sibling above, or below the nearest sibling below.
export const keyboardTargetIndex = (column: BoardColumn, taskId: string, direction: 'up' | 'down'): number => {
  const from = column.cards.findIndex((card) => card.task.id === taskId);
  const dragged = column.cards[from];
  if (dragged === undefined) return from;
  switch (direction) {
    case 'up': {
      const above = column.cards.slice(0, from).findLastIndex((card) => isSibling(dragged, card));
      return above === -1 ? from : above;
    }
    case 'down': {
      const offset = column.cards.slice(from + 1).findIndex((card) => isSibling(dragged, card));
      return offset === -1 ? from : from + 1 + offset + 1;
    }
    default: {
      const _exhaustive: never = direction;
      throw new Error(`unhandled direction: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const planStatusChange = (task: TaskItem, to: BoardStatus): StatusPlan => (task.boardStatus === to ? { kind: 'noop' } : { kind: 'status', taskId: task.id, taskListId: task.taskListId, to });

const ORDER: readonly BoardStatus[] = ['todo', 'doing', 'done'];

export const adjacentStatus = (status: BoardStatus, side: 'left' | 'right'): { readonly kind: 'none' } | { readonly kind: 'some'; readonly status: BoardStatus } => {
  const neighbour = ORDER[ORDER.indexOf(status) + (side === 'left' ? -1 : 1)];
  return neighbour === undefined ? { kind: 'none' } : { kind: 'some', status: neighbour };
};
