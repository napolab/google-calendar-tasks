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
  it('puts every task, subtasks included, in the column of its own status in outline order', () => {
    const board = buildBoard([work, home], { kind: 'all' }, '2026-11-17');

    expect(ids(board)).toEqual([
      ['todo', ['a', 'a2', 'd', 'h']],
      ['doing', ['b']],
      ['done', ['a1', 'c']],
    ]);
  });

  it('labels a subtask card with its parent', () => {
    const board = buildBoard([work], { kind: 'all' }, '2026-11-17');
    const a2 = board.columns[0]?.cards.find((card) => card.task.id === 'a2');

    expect(a2?.nesting).toEqual({ kind: 'subtask', parentId: 'a', parentTitle: 'a' });
  });

  it('labels a subtask with （無題） when its parent has an empty title', () => {
    const list: TaskListPage = { ...work, tasks: [t('p', { title: '' }), t('s', { parent: { kind: 'subtask', parentId: 'p' }, depth: 1 })] };
    const card = buildBoard([list], { kind: 'all' }, '2026-11-17').columns[0]?.cards.find((c) => c.task.id === 's');

    expect(card?.nesting).toEqual({ kind: 'subtask', parentId: 'p', parentTitle: '（無題）' });
  });

  it('counts a parent’s subtasks per column, wherever they are shown', () => {
    const cards = buildBoard([work], { kind: 'all' }, '2026-11-17').columns[0]?.cards ?? [];

    expect(cards.find((card) => card.task.id === 'a')?.nesting).toEqual({ kind: 'root', subtaskCounts: { todo: 1, doing: 0, done: 1 }, subtaskCountsPartial: false });
    expect(cards.find((card) => card.task.id === 'd')?.nesting).toEqual({ kind: 'root', subtaskCounts: { todo: 0, doing: 0, done: 0 }, subtaskCountsPartial: false });
  });

  it('flags a root card of a truncated list as having possibly partial subtask counts', () => {
    const truncated: TaskListPage = { ...work, truncated: true };
    const root = (list: TaskListPage) => buildBoard([list], { kind: 'all' }, '2026-11-17').columns[0]?.cards.find((c) => c.task.id === 'a')?.nesting;

    expect(root(truncated)).toMatchObject({ kind: 'root', subtaskCountsPartial: true });
    expect(root(work)).toMatchObject({ kind: 'root', subtaskCountsPartial: false });
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
    expect(board.columns[0]?.cards).toHaveLength(3);
  });

  it('carries the list title on each card and the lists for the selector', () => {
    const board = buildBoard([work, home], { kind: 'all' }, '2026-11-17');

    expect(board.columns[0]?.cards[3]).toMatchObject({ listTitle: 'Home' });
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
      ['sub', true],
    ]);
    expect(board.columns[2]?.cards.map((card) => [card.task.id, card.overdue])).toEqual([['donePast', false]]);
  });

  it('marks a subtask whose parent is not in the page as an orphan card', () => {
    const list: TaskListPage = { ...work, tasks: [t('x'), t('o', { parent: { kind: 'subtask', parentId: 'elsewhere' } })] };

    expect(buildBoard([list], { kind: 'all' }, '2026-11-17').columns[0]?.cards.map((card) => [card.task.id, card.nesting.kind])).toEqual([
      ['x', 'root'],
      ['o', 'orphan'],
    ]);
  });

  it('treats a subtask whose parent id is not in its list as an orphan', () => {
    const list: TaskListPage = { ...work, tasks: [t('x1', { parent: { kind: 'subtask', parentId: 'missing' }, depth: 1 })] };

    expect(buildBoard([list], { kind: 'all' }, '2026-11-17').columns[0]?.cards[0]?.nesting).toEqual({ kind: 'orphan' });
  });
});

describe('tokyoToday', () => {
  it('is the calendar day in Asia/Tokyo, not in UTC', () => {
    expect(tokyoToday(Date.UTC(2026, 10, 16, 15, 0, 0))).toBe('2026-11-17');
    expect(tokyoToday(Date.UTC(2026, 10, 16, 14, 59, 59))).toBe('2026-11-16');
  });
});
