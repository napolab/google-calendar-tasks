import type { BoardColumn } from '../board';
import type { BoardStatus, TaskItem } from '../wire';

// Drag & drop / keyboard moves → the tool call they mean. Reorder maps to move_task (always within the task's own list,
// at the top level); a column change maps to set_task_status.

// move_task's placement among the top-level tasks of the list: right after a sibling, or first.
export type Placement = { readonly kind: 'first' } | { readonly kind: 'after'; readonly previousId: string };

export type ReorderPlan =
  | { readonly kind: 'move'; readonly taskId: string; readonly taskListId: string; readonly placement: Placement }
  | { readonly kind: 'noop' }
  // otherList: the drop point has no neighbour from the card's own list (all-lists view).
  // locked: the done column, or an orphan subtask (move_task without parentId would un-nest it).
  | { readonly kind: 'rejected'; readonly reason: 'otherList' | 'locked' };

export type StatusPlan = { readonly kind: 'status'; readonly taskId: string; readonly taskListId: string; readonly to: BoardStatus } | { readonly kind: 'noop' };

// `targetIndex` is the drop point among the column's cards as shown, counted with the dragged card still in place
// (0 = above the first card, cards.length = below the last).
export const planReorder = (column: BoardColumn, taskId: string, targetIndex: number): ReorderPlan => {
  const from = column.cards.findIndex((card) => card.task.id === taskId);
  const dragged = column.cards[from];
  if (dragged === undefined) return { kind: 'noop' };
  if (column.status === 'done' || dragged.orphan) return { kind: 'rejected', reason: 'locked' };

  const index = targetIndex > from ? targetIndex - 1 : targetIndex;
  if (index === from) return { kind: 'noop' };

  const others = column.cards.filter((card) => card.task.id !== taskId);
  const sameList = (card: { readonly task: TaskItem } | undefined): boolean => card !== undefined && card.task.taskListId === dragged.task.taskListId;
  if (!sameList(others[index - 1]) && !sameList(others[index])) return { kind: 'rejected', reason: 'otherList' };

  const previous = others
    .slice(0, index)
    .filter((card) => sameList(card) && !card.orphan)
    .at(-1);
  return {
    kind: 'move',
    taskId,
    taskListId: dragged.task.taskListId,
    placement: previous === undefined ? { kind: 'first' } : { kind: 'after', previousId: previous.task.id },
  };
};

// The drop point a "move up / down" button means: above the previous card, or below the next one.
export const keyboardTargetIndex = (column: BoardColumn, taskId: string, direction: 'up' | 'down'): number => {
  const from = column.cards.findIndex((card) => card.task.id === taskId);
  switch (direction) {
    case 'up':
      return Math.max(from - 1, 0);
    case 'down':
      return Math.min(from + 2, column.cards.length);
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
