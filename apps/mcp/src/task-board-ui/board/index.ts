import { DEFAULT_TIME_ZONE, dayjs } from '@napolab/gct-core/dayjs';

import type { BoardSelection, BoardStatus, ListedTaskItem, TaskItem, TaskListPage } from '../wire';

// The board model: lists of tasks (outline order) → three columns of cards, subtasks nested in their parent card.

export const BOARD_STATUSES: readonly BoardStatus[] = ['todo', 'doing', 'done'];

export type BoardSubtask = { readonly task: TaskItem; readonly depth: number; readonly overdue: boolean };

export type BoardCard = {
  readonly task: TaskItem;
  readonly listTitle: string;
  readonly overdue: boolean;
  readonly subtasks: readonly BoardSubtask[];
  // A subtask whose parent is not on the page: shown as a card, but never reordered (move_task would un-nest it).
  readonly orphan: boolean;
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

// Outline order → cards: each depth-0 task opens a card, deeper tasks join the card above.
const cardsOf = (list: TaskListPage, today: string): readonly BoardCard[] =>
  list.tasks.reduce<readonly BoardCard[]>((cards, task: ListedTaskItem) => {
    if (task.depth === 0) return [...cards, { task, listTitle: list.title, overdue: isOverdue(task, today), subtasks: [], orphan: task.parent.kind === 'subtask' }];
    const last = cards.at(-1);
    if (last === undefined) return cards;
    return [...cards.slice(0, -1), { ...last, subtasks: [...last.subtasks, { task, depth: task.depth, overdue: isOverdue(task, today) }] }];
  }, []);

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
