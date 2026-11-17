import { describe, expect, it } from 'vitest';

import { buildBoard, tokyoToday } from './index';

import type { ListedTaskItem, TaskListPage } from '../wire';

const t = (id: string, overrides: Partial<ListedTaskItem> = {}): ListedTaskItem => ({
  id,
  taskListId: 'work',
  title: id,
  body: '',
  boardStatus: 'todo',
  unknownStatusTag: { kind: 'none' },
  due: { kind: 'none' },
  parent: { kind: 'root' },
  depth: 0,
  ...overrides,
});

const work: TaskListPage = {
  taskListId: 'work',
  title: 'Work',
  truncated: false,
  tasks: [
    t('a'),
    t('a1', { parent: { kind: 'subtask', parentId: 'a' }, depth: 1, boardStatus: 'done' }),
    t('a2', { parent: { kind: 'subtask', parentId: 'a' }, depth: 1 }),
    t('b', { boardStatus: 'doing' }),
    t('c', { boardStatus: 'done' }),
    t('d'),
  ],
};

const home: TaskListPage = { taskListId: 'home', title: 'Home', truncated: true, tasks: [t('h', { taskListId: 'home' })] };

const ids = (board: ReturnType<typeof buildBoard>) => board.columns.map((column) => [column.status, column.cards.map((card) => card.task.id)]);

describe('buildBoard', () => {
  it('groups top-level tasks into todo / doing / done in list order, then outline order', () => {
    const board = buildBoard([work, home], { kind: 'all' }, '2026-11-17');

    expect(ids(board)).toEqual([
      ['todo', ['a', 'd', 'h']],
      ['doing', ['b']],
      ['done', ['c']],
    ]);
  });

  it('nests subtasks inside their parent card, whatever their own status', () => {
    const board = buildBoard([work], { kind: 'all' }, '2026-11-17');

    expect(board.columns[0]?.cards[0]?.subtasks.map((subtask) => [subtask.task.id, subtask.task.boardStatus])).toEqual([
      ['a1', 'done'],
      ['a2', 'todo'],
    ]);
  });

  it('shows only the selected list (no list badge), and every list with badges for all', () => {
    const one = buildBoard([work, home], { kind: 'list', taskListId: 'home' }, '2026-11-17');
    expect(ids(one)).toEqual([
      ['todo', ['h']],
      ['doing', []],
      ['done', []],
    ]);
    expect(one.showListBadge).toBe(false);
    expect(buildBoard([work, home], { kind: 'all' }, '2026-11-17').showListBadge).toBe(true);
  });

  it('falls back to every list when the selected list is gone', () => {
    const board = buildBoard([work], { kind: 'list', taskListId: 'gone' }, '2026-11-17');

    expect(board.selection).toEqual({ kind: 'all' });
    expect(board.columns[0]?.cards).toHaveLength(2);
  });

  it('carries the list title on each card and the lists for the selector', () => {
    const board = buildBoard([work, home], { kind: 'all' }, '2026-11-17');

    expect(board.columns[0]?.cards[2]).toMatchObject({ listTitle: 'Home' });
    expect(board.lists).toEqual([
      { taskListId: 'work', title: 'Work' },
      { taskListId: 'home', title: 'Home' },
    ]);
  });

  it('names the shown lists that have more tasks than the board received', () => {
    expect(buildBoard([work, home], { kind: 'all' }, '2026-11-17').truncatedLists).toEqual(['Home']);
    expect(buildBoard([work, home], { kind: 'list', taskListId: 'work' }, '2026-11-17').truncatedLists).toEqual([]);
  });

  it('flags open tasks due before today (Asia/Tokyo) as overdue, never done ones', () => {
    const list: TaskListPage = {
      ...work,
      tasks: [
        t('past', { due: { kind: 'date', date: '2026-11-16' } }),
        t('today', { due: { kind: 'date', date: '2026-11-17' } }),
        t('donePast', { due: { kind: 'date', date: '2026-11-01' }, boardStatus: 'done' }),
        t('sub', { due: { kind: 'date', date: '2026-11-10' }, parent: { kind: 'subtask', parentId: 'donePast' }, depth: 1 }),
      ],
    };
    const board = buildBoard([list], { kind: 'all' }, '2026-11-17');

    expect(board.columns[0]?.cards.map((card) => [card.task.id, card.overdue])).toEqual([
      ['past', true],
      ['today', false],
    ]);
    expect(board.columns[2]?.cards[0]).toMatchObject({ overdue: false, subtasks: [{ overdue: true }] });
  });

  it('marks a subtask whose parent is not in the page as an orphan card', () => {
    const list: TaskListPage = { ...work, tasks: [t('x'), t('o', { parent: { kind: 'subtask', parentId: 'elsewhere' } })] };

    expect(buildBoard([list], { kind: 'all' }, '2026-11-17').columns[0]?.cards.map((card) => [card.task.id, card.orphan])).toEqual([
      ['x', false],
      ['o', true],
    ]);
  });
});

describe('tokyoToday', () => {
  it('is the calendar day in Asia/Tokyo, not in UTC', () => {
    expect(tokyoToday(Date.UTC(2026, 10, 16, 15, 0, 0))).toBe('2026-11-17');
    expect(tokyoToday(Date.UTC(2026, 10, 16, 14, 59, 59))).toBe('2026-11-16');
  });
});
