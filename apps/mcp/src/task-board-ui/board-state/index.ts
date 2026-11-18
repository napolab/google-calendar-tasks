import type { Placement } from '../moves';
import type { BoardStatus, ListedTaskItem, TaskItem, TaskListPage } from '../wire';

// Optimistic board state: the lists as the server last sent them (`base`) plus the changes still in flight (`pending`).
// What the board shows is every pending change applied to base, so a failed change is rolled back by dropping it —
// concurrent changes stay — and a succeeded one is folded into base with the task the server returned.

export type PendingOp = { readonly id: number } & (
  | { readonly kind: 'status'; readonly taskId: string; readonly taskListId: string; readonly to: BoardStatus }
  | { readonly kind: 'reorder'; readonly taskId: string; readonly taskListId: string; readonly parent: TaskItem['parent']; readonly placement: Placement }
);

export type Notice = { readonly kind: 'none' } | { readonly kind: 'info'; readonly message: string } | { readonly kind: 'error'; readonly message: string };

export type BoardState = {
  readonly base: readonly TaskListPage[];
  readonly pending: readonly PendingOp[];
  readonly notice: Notice;
};

export type BoardEvent =
  | { readonly type: 'loaded'; readonly lists: readonly TaskListPage[] }
  | { readonly type: 'started'; readonly op: PendingOp }
  | { readonly type: 'succeeded'; readonly opId: number; readonly task: TaskItem }
  | { readonly type: 'failed'; readonly opId: number; readonly message: string }
  | { readonly type: 'noticed'; readonly message: string }
  | { readonly type: 'dismissed' };

export const INITIAL_BOARD_STATE: BoardState = { base: [], pending: [], notice: { kind: 'none' } };

const mapList = (lists: readonly TaskListPage[], taskListId: string, update: (tasks: readonly ListedTaskItem[]) => readonly ListedTaskItem[]): readonly TaskListPage[] =>
  lists.map((list) => (list.taskListId === taskListId ? { ...list, tasks: update(list.tasks) } : list));

// The task at `index` and the subtasks right below it (deeper than it).
const blockEnd = (tasks: readonly ListedTaskItem[], index: number): number => {
  const depth = tasks[index]?.depth ?? 0;
  const next = tasks.findIndex((task, at) => at > index && task.depth <= depth);
  return next === -1 ? tasks.length : next;
};

// `first` is the top of the list for a top-level task, but right under its parent for a subtask.
const firstIndex = (rest: readonly ListedTaskItem[], parent: TaskItem['parent']): number => {
  switch (parent.kind) {
    case 'root':
      return 0;
    case 'subtask': {
      const parentIndex = rest.findIndex((task) => task.id === parent.parentId);
      return parentIndex === -1 ? -1 : parentIndex + 1;
    }
    default: {
      const _exhaustive: never = parent;
      throw new Error(`unhandled parent: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const insertionIndex = (rest: readonly ListedTaskItem[], parent: TaskItem['parent'], placement: Placement): number => {
  switch (placement.kind) {
    case 'first':
      return firstIndex(rest, parent);
    case 'after': {
      const previous = rest.findIndex((task) => task.id === placement.previousId);
      return previous === -1 ? -1 : blockEnd(rest, previous);
    }
    default: {
      const _exhaustive: never = placement;
      throw new Error(`unhandled placement: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const reorder =
  (taskId: string, parent: TaskItem['parent'], placement: Placement) =>
  (tasks: readonly ListedTaskItem[]): readonly ListedTaskItem[] => {
    const start = tasks.findIndex((task) => task.id === taskId);
    if (start === -1) return tasks;
    const end = blockEnd(tasks, start);
    const block = tasks.slice(start, end);
    const rest = [...tasks.slice(0, start), ...tasks.slice(end)];
    const at = insertionIndex(rest, parent, placement);
    if (at === -1) return tasks;
    return [...rest.slice(0, at), ...block, ...rest.slice(at)];
  };

const applyOp = (lists: readonly TaskListPage[], op: PendingOp): readonly TaskListPage[] => {
  switch (op.kind) {
    case 'status':
      return mapList(lists, op.taskListId, (tasks) => tasks.map((task) => (task.id === op.taskId ? { ...task, boardStatus: op.to } : task)));
    case 'reorder':
      return mapList(lists, op.taskListId, reorder(op.taskId, op.parent, op.placement));
    default: {
      const _exhaustive: never = op;
      throw new Error(`unhandled op: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// The server's copy of a task replaces the board's (its depth in the outline stays).
const upsertTask = (lists: readonly TaskListPage[], task: TaskItem): readonly TaskListPage[] =>
  lists.map((list) => ({ ...list, tasks: list.tasks.map((listed) => (listed.id === task.id ? { ...task, depth: listed.depth } : listed)) }));

const settle = (state: BoardState, opId: number, settleBase: (base: readonly TaskListPage[], op: PendingOp) => readonly TaskListPage[], notice: Notice): BoardState => {
  const op = state.pending.find((candidate) => candidate.id === opId);
  if (op === undefined) return state;
  return { base: settleBase(state.base, op), pending: state.pending.filter((candidate) => candidate.id !== opId), notice };
};

export const reduceBoard = (state: BoardState, event: BoardEvent): BoardState => {
  switch (event.type) {
    case 'loaded':
      return { ...state, base: event.lists };
    case 'started':
      return { ...state, pending: [...state.pending, event.op] };
    case 'succeeded':
      return settle(state, event.opId, (base, op) => upsertTask(applyOp(base, op), event.task), state.notice);
    case 'failed':
      return settle(state, event.opId, (base) => base, { kind: 'error', message: event.message });
    case 'noticed':
      return { ...state, notice: { kind: 'info', message: event.message } };
    case 'dismissed':
      return { ...state, notice: { kind: 'none' } };
    default: {
      const _exhaustive: never = event;
      throw new Error(`unhandled event: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const visibleLists = (state: BoardState): readonly TaskListPage[] => state.pending.reduce(applyOp, state.base);

export const isPending = (state: BoardState, taskId: string): boolean => state.pending.some((op) => op.taskId === taskId);
