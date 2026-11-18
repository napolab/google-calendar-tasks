import { DEFAULT_TIME_ZONE, dayjs } from '@napolab/gct-core/dayjs';

import type { BoardSelection, BoardStatus, ListedTaskItem, TaskItem, TaskListPage } from '../wire';

// The board model: lists of tasks (outline order) → three columns of cards, every task (subtasks too) is its own card in the column of its status.

export const BOARD_STATUSES: readonly BoardStatus[] = ['todo', 'doing', 'done'];

export type SubtaskCounts = Readonly<Record<BoardStatus, number>>;

// root: a top-level task (counts of its subtasks per column; all 0 = no subtasks). subtaskCountsPartial: the list was truncated, so some subtasks may be missing from the counts.
// subtask: shown under its parent's title. orphan: a subtask whose parent is not in the page (never reordered).
export type CardNesting =
  | { readonly kind: 'root'; readonly subtaskCounts: SubtaskCounts; readonly subtaskCountsPartial: boolean }
  | { readonly kind: 'subtask'; readonly parentId: string; readonly parentTitle: string }
  | { readonly kind: 'orphan' };

export type BoardCard = {
  readonly task: TaskItem;
  readonly listTitle: string;
  readonly overdue: boolean;
  readonly nesting: CardNesting;
};

export type BoardColumn = { readonly status: BoardStatus; readonly cards: readonly BoardCard[] };

export type Board = {
  readonly columns: readonly BoardColumn[];
  // The selection actually shown (a list that disappeared falls back to every list).
  readonly selection: BoardSelection;
  readonly lists: readonly { readonly taskListId: string; readonly title: string }[];
  // Cards carry a list badge when several lists are shown.
  readonly showListBadge: boolean;
  // Titles of shown lists with more tasks than the board received.
  readonly truncatedLists: readonly string[];
};

// Today's calendar day in Asia/Tokyo (due dates are calendar days).
export const tokyoToday = (epochMs: number): string => dayjs(epochMs).tz(DEFAULT_TIME_ZONE).format('YYYY-MM-DD');

const isOverdue = (task: TaskItem, today: string): boolean => {
  switch (task.due.kind) {
    case 'none':
      return false;
    case 'date':
      return task.boardStatus !== 'done' && dayjs.utc(task.due.date).isBefore(dayjs.utc(today), 'day');
    default: {
      const _exhaustive: never = task.due;
      throw new Error(`unhandled due: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const effectiveSelection = (lists: readonly TaskListPage[], selection: BoardSelection): BoardSelection => {
  switch (selection.kind) {
    case 'all':
      return selection;
    case 'list':
      return lists.some((list) => list.taskListId === selection.taskListId) ? selection : { kind: 'all' };
    default: {
      const _exhaustive: never = selection;
      throw new Error(`unhandled selection: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const isShown = (selection: BoardSelection, list: TaskListPage): boolean => selection.kind === 'all' || selection.taskListId === list.taskListId;

const UNTITLED = '（無題）';

const countSubtasks = (task: ListedTaskItem, list: TaskListPage): SubtaskCounts => {
  const children = list.tasks.filter((other) => other.parent.kind === 'subtask' && other.parent.parentId === task.id);
  return {
    todo: children.filter((child) => child.boardStatus === 'todo').length,
    doing: children.filter((child) => child.boardStatus === 'doing').length,
    done: children.filter((child) => child.boardStatus === 'done').length,
  };
};

const nestingOf = (task: ListedTaskItem, list: TaskListPage): CardNesting => {
  switch (task.parent.kind) {
    case 'root':
      return task.depth === 0 ? { kind: 'root', subtaskCounts: countSubtasks(task, list), subtaskCountsPartial: list.truncated } : { kind: 'orphan' };
    case 'subtask': {
      const { parentId } = task.parent;
      const parent = list.tasks.find((other) => other.id === parentId);
      if (parent === undefined) return { kind: 'orphan' };
      return { kind: 'subtask', parentId, parentTitle: parent.title === '' ? UNTITLED : parent.title };
    }
    default: {
      const _exhaustive: never = task.parent;
      throw new Error(`unhandled parent: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Outline order → one card per task.
const cardsOf = (list: TaskListPage, today: string): readonly BoardCard[] =>
  list.tasks.map((task) => ({ task, listTitle: list.title, overdue: isOverdue(task, today), nesting: nestingOf(task, list) }));

export const buildBoard = (lists: readonly TaskListPage[], selection: BoardSelection, today: string): Board => {
  const shownSelection = effectiveSelection(lists, selection);
  const shown = lists.filter((list) => isShown(shownSelection, list));
  const cards = shown.flatMap((list) => cardsOf(list, today));
  return {
    columns: BOARD_STATUSES.map((status) => ({ status, cards: cards.filter((card) => card.task.boardStatus === status) })),
    selection: shownSelection,
    lists: lists.map((list) => ({ taskListId: list.taskListId, title: list.title })),
    showListBadge: shownSelection.kind === 'all' && lists.length > 1,
    truncatedLists: shown.filter((list) => list.truncated).map((list) => list.title),
  };
};
