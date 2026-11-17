import { describe, expect, it } from 'vitest';

import { INITIAL_BOARD_STATE, reduceBoard, visibleLists } from './index';

import type { BoardEvent, BoardState, PendingOp } from './index';
import type { ListedTaskItem, TaskItem, TaskListPage } from '../wire';

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
  tasks: [t('a'), t('a1', { parent: { kind: 'subtask', parentId: 'a' }, depth: 1 }), t('b'), t('c')],
};
const home: TaskListPage = { taskListId: 'home', title: 'Home', truncated: false, tasks: [t('h', { taskListId: 'home' })] };

const run = (events: readonly BoardEvent[]): BoardState => events.reduce(reduceBoard, INITIAL_BOARD_STATE);

const loaded: BoardEvent = { type: 'loaded', lists: [work, home] };

const order = (state: BoardState, listIndex = 0) => visibleLists(state)[listIndex]?.tasks.map((task) => task.id);

const statusOf = (state: BoardState, id: string) =>
  visibleLists(state)
    .flatMap((list) => list.tasks)
    .find((task) => task.id === id)?.boardStatus;

const toDoing: PendingOp = { id: 1, kind: 'status', taskId: 'b', taskListId: 'work', to: 'doing' };

describe('reduceBoard', () => {
  it('shows the loaded lists', () => {
    expect(visibleLists(run([loaded]))).toEqual([work, home]);
  });

  it('applies a started status change at once (optimistic)', () => {
    expect(statusOf(run([loaded, { type: 'started', op: toDoing }]), 'b')).toBe('doing');
  });

  it('rolls a failed change back and reports the error', () => {
    const state = run([loaded, { type: 'started', op: toDoing }, { type: 'failed', opId: 1, message: 'Google API 500' }]);

    expect(statusOf(state, 'b')).toBe('todo');
    expect(state.pending).toEqual([]);
    expect(state.notice).toEqual({ kind: 'error', message: 'Google API 500' });
  });

  it('keeps a succeeded change and takes the task as the server returned it', () => {
    const fromServer: TaskItem = { ...t('b'), boardStatus: 'doing', body: 'fresh body' };
    const state = run([loaded, { type: 'started', op: toDoing }, { type: 'succeeded', opId: 1, task: fromServer }]);

    expect(state.pending).toEqual([]);
    expect(visibleLists(state)[0]?.tasks[2]).toEqual({ ...fromServer, depth: 0 });
  });

  it('rolls back only the failed one of two concurrent changes', () => {
    const second: PendingOp = { id: 2, kind: 'status', taskId: 'c', taskListId: 'work', to: 'done' };
    const state = run([loaded, { type: 'started', op: toDoing }, { type: 'started', op: second }, { type: 'failed', opId: 1, message: 'x' }]);

    expect(statusOf(state, 'b')).toBe('todo');
    expect(statusOf(state, 'c')).toBe('done');
  });

  it('keeps pending changes on top of a reload', () => {
    const state = run([loaded, { type: 'started', op: toDoing }, loaded]);

    expect(statusOf(state, 'b')).toBe('doing');
  });

  describe('reorder', () => {
    it('moves a task (with its subtasks) to the top of its list', () => {
      const state = run([loaded, { type: 'started', op: { id: 1, kind: 'reorder', taskId: 'c', taskListId: 'work', placement: { kind: 'first' } } }]);

      expect(order(state)).toEqual(['c', 'a', 'a1', 'b']);
    });

    it('moves a task after a sibling, past that sibling’s subtasks', () => {
      const state = run([loaded, { type: 'started', op: { id: 1, kind: 'reorder', taskId: 'c', taskListId: 'work', placement: { kind: 'after', previousId: 'a' } } }]);

      expect(order(state)).toEqual(['a', 'a1', 'c', 'b']);
    });

    it('carries a parent’s subtasks along', () => {
      const state = run([loaded, { type: 'started', op: { id: 1, kind: 'reorder', taskId: 'a', taskListId: 'work', placement: { kind: 'after', previousId: 'c' } } }]);

      expect(order(state)).toEqual(['b', 'c', 'a', 'a1']);
    });

    it('rolls a failed reorder back, and keeps a succeeded one after the server answers', () => {
      const op: PendingOp = { id: 1, kind: 'reorder', taskId: 'c', taskListId: 'work', placement: { kind: 'first' } };

      expect(order(run([loaded, { type: 'started', op }, { type: 'failed', opId: 1, message: 'x' }]))).toEqual(['a', 'a1', 'b', 'c']);
      expect(order(run([loaded, { type: 'started', op }, { type: 'succeeded', opId: 1, task: t('c') }]))).toEqual(['c', 'a', 'a1', 'b']);
    });

    it('leaves other lists alone', () => {
      const state = run([loaded, { type: 'started', op: { id: 1, kind: 'reorder', taskId: 'c', taskListId: 'work', placement: { kind: 'first' } } }]);

      expect(order(state, 1)).toEqual(['h']);
    });
  });

  it('shows an info notice and dismisses it', () => {
    const noticed = run([loaded, { type: 'noticed', message: 'hint' }]);

    expect(noticed.notice).toEqual({ kind: 'info', message: 'hint' });
    expect(reduceBoard(noticed, { type: 'dismissed' }).notice).toEqual({ kind: 'none' });
  });
});
