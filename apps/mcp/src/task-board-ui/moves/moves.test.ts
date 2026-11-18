import { describe, expect, it } from 'vitest';

import { adjacentStatus, keyboardTargetIndex, planReorder, planStatusChange } from './index';

import type { BoardCard, BoardColumn } from '../board';
import type { BoardStatus } from '../wire';

const card = (id: string, taskListId = 'work', overrides: Partial<BoardCard> = {}): BoardCard => ({
  task: {
    id,
    taskListId,
    title: id,
    body: '',
    boardStatus: 'todo',
    unknownStatusTag: { kind: 'none' },
    due: { kind: 'none' },
    parent: { kind: 'root' },
  },
  listTitle: taskListId,
  overdue: false,
  nesting: { kind: 'root', subtaskCounts: { todo: 0, doing: 0, done: 0 } },
  ...overrides,
});

const sub = (id: string, parentId: string, taskListId = 'work'): BoardCard =>
  card(id, taskListId, {
    task: { ...card(id, taskListId).task, parent: { kind: 'subtask', parentId } },
    nesting: { kind: 'subtask', parentId, parentTitle: parentId },
  });

const column = (cards: readonly BoardCard[], status: BoardStatus = 'todo'): BoardColumn => ({ status, cards });

describe('planReorder', () => {
  const todo = column([card('a'), card('b'), card('c')]);

  it('places the card after the card above the drop point', () => {
    expect(planReorder(todo, 'a', 3)).toEqual({ kind: 'move', taskId: 'a', taskListId: 'work', parent: { kind: 'root' }, placement: { kind: 'after', previousId: 'c' } });
    expect(planReorder(todo, 'c', 1)).toEqual({ kind: 'move', taskId: 'c', taskListId: 'work', parent: { kind: 'root' }, placement: { kind: 'after', previousId: 'a' } });
  });

  it('places the card first when dropped at the top', () => {
    expect(planReorder(todo, 'c', 0)).toEqual({ kind: 'move', taskId: 'c', taskListId: 'work', parent: { kind: 'root' }, placement: { kind: 'first' } });
  });

  it('is a no-op when the card would stay where it is', () => {
    expect(planReorder(todo, 'b', 1)).toEqual({ kind: 'noop' });
    expect(planReorder(todo, 'b', 2)).toEqual({ kind: 'noop' });
    expect(planReorder(todo, 'missing', 0)).toEqual({ kind: 'noop' });
  });

  describe('every list shown', () => {
    // work: a, b — home: h1, h2
    const mixed = column([card('a'), card('b'), card('h1', 'home'), card('h2', 'home')]);

    it('moves next to a card of the same list (after it, or first when it is the first card of that list)', () => {
      expect(planReorder(mixed, 'h2', 2)).toEqual({ kind: 'move', taskId: 'h2', taskListId: 'home', parent: { kind: 'root' }, placement: { kind: 'first' } });
      expect(planReorder(mixed, 'a', 2)).toEqual({ kind: 'move', taskId: 'a', taskListId: 'work', parent: { kind: 'root' }, placement: { kind: 'after', previousId: 'b' } });
    });

    it('rejects a drop between cards of other lists', () => {
      expect(planReorder(mixed, 'a', 4)).toEqual({ kind: 'rejected', reason: 'otherList' });
      expect(planReorder(mixed, 'h1', 0)).toEqual({ kind: 'rejected', reason: 'otherList' });
    });
  });

  it('never uses an orphan subtask as the previous sibling, and never moves one', () => {
    const withOrphan = column([card('a'), card('o', 'work', { nesting: { kind: 'orphan' } }), card('b'), card('c')]);

    expect(planReorder(withOrphan, 'c', 2)).toEqual({ kind: 'move', taskId: 'c', taskListId: 'work', parent: { kind: 'root' }, placement: { kind: 'after', previousId: 'a' } });
    expect(planReorder(withOrphan, 'o', 0)).toEqual({ kind: 'rejected', reason: 'locked' });
  });

  describe('subtasks', () => {
    const col = column([card('a'), sub('a1', 'a'), sub('a2', 'a'), sub('b1', 'b'), card('d')]);

    it('reorders a subtask among its siblings, keeping its parent', () => {
      expect(planReorder(col, 'a2', 1)).toEqual({ kind: 'move', taskId: 'a2', taskListId: 'work', parent: { kind: 'subtask', parentId: 'a' }, placement: { kind: 'first' } });
      expect(planReorder(col, 'a1', 3)).toMatchObject({ kind: 'move', placement: { kind: 'after', previousId: 'a2' } });
    });

    it('rejects a subtask dropped away from its siblings', () => {
      expect(planReorder(col, 'a1', 5)).toEqual({ kind: 'rejected', reason: 'otherParent' });
    });

    it('rejects a top-level card dropped between subtask cards', () => {
      expect(planReorder(col, 'd', 2)).toEqual({ kind: 'rejected', reason: 'otherList' });
    });
  });

  it('does not reorder the done column', () => {
    expect(planReorder(column([card('a'), card('b')], 'done'), 'b', 0)).toEqual({ kind: 'rejected', reason: 'locked' });
  });
});

describe('keyboardTargetIndex', () => {
  const todo = column([card('a'), card('b'), card('c')]);

  it('maps up / down to the drop index above the previous card / below the next card', () => {
    expect(keyboardTargetIndex(todo, 'b', 'up')).toBe(0);
    expect(keyboardTargetIndex(todo, 'b', 'down')).toBe(3);
    expect(planReorder(todo, 'b', keyboardTargetIndex(todo, 'b', 'up'))).toMatchObject({ placement: { kind: 'first' } });
    expect(planReorder(todo, 'b', keyboardTargetIndex(todo, 'b', 'down'))).toMatchObject({ placement: { kind: 'after', previousId: 'c' } });
  });

  it('skips cards that are not siblings', () => {
    const col = column([card('a'), sub('a1', 'a'), sub('a2', 'a'), sub('b1', 'b'), card('d')]);

    expect(planReorder(col, 'd', keyboardTargetIndex(col, 'd', 'up'))).toMatchObject({ placement: { kind: 'first' } });
    expect(planReorder(col, 'a', keyboardTargetIndex(col, 'a', 'down'))).toMatchObject({ placement: { kind: 'after', previousId: 'd' } });
    expect(planReorder(col, 'a1', keyboardTargetIndex(col, 'a1', 'up'))).toEqual({ kind: 'noop' });
  });

  it('stays in place at either end', () => {
    expect(planReorder(todo, 'a', keyboardTargetIndex(todo, 'a', 'up'))).toEqual({ kind: 'noop' });
    expect(planReorder(todo, 'c', keyboardTargetIndex(todo, 'c', 'down'))).toEqual({ kind: 'noop' });
  });
});

describe('planStatusChange', () => {
  it('moves a task to another column, or does nothing for its own column', () => {
    expect(planStatusChange(card('a').task, 'doing')).toEqual({ kind: 'status', taskId: 'a', taskListId: 'work', to: 'doing' });
    expect(planStatusChange(card('a').task, 'todo')).toEqual({ kind: 'noop' });
  });
});

describe('adjacentStatus', () => {
  it('names the column to the left / right, or none at the edges', () => {
    expect(adjacentStatus('todo', 'right')).toEqual({ kind: 'some', status: 'doing' });
    expect(adjacentStatus('doing', 'left')).toEqual({ kind: 'some', status: 'todo' });
    expect(adjacentStatus('done', 'right')).toEqual({ kind: 'none' });
    expect(adjacentStatus('todo', 'left')).toEqual({ kind: 'none' });
  });
});
