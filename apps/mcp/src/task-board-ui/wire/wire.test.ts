import { describe, expect, it } from 'vitest';

import { parseBoardPayload, parseListing, parseTask } from './index';

const wireTask = {
  id: 't1',
  taskListId: 'l1',
  title: 'Write report',
  notes: '[status: doing]\nfirst draft',
  body: 'first draft',
  status: 'needsAction',
  boardStatus: 'doing',
  unknownStatusTag: null,
  due: '2026-11-20',
  parentId: null,
  completedAt: null,
  position: '0001',
  updated: 'u',
  deleted: false,
  hidden: false,
  links: [],
  assignment: null,
};

const page = { taskListId: 'l1', title: 'Work', tasks: [{ ...wireTask, depth: 0 }], nextPageToken: null };

const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

const item = {
  id: 't1',
  taskListId: 'l1',
  title: 'Write report',
  body: 'first draft',
  boardStatus: 'doing',
  unknownStatusTag: { kind: 'none' },
  due: { kind: 'date', date: '2026-11-20' },
  parent: { kind: 'root' },
};

describe('parseListing (list_tasks result)', () => {
  it('reads the JSON text into lists of board items (nulls become named variants)', () => {
    expect(parseListing(text({ lists: [page] }))).toEqual({
      kind: 'ok',
      value: [{ taskListId: 'l1', title: 'Work', truncated: false, tasks: [{ ...item, depth: 0 }] }],
    });
  });

  it('marks a list with a next page as truncated, and keeps subtasks / unknown tags / no due', () => {
    const subtask = { ...wireTask, id: 't2', parentId: 't1', due: null, unknownStatusTag: 'blocked', boardStatus: 'todo', depth: 1 };
    const result = parseListing(text({ lists: [{ ...page, tasks: [subtask], nextPageToken: 'p2' }] }));

    expect(result).toEqual({
      kind: 'ok',
      value: [
        {
          taskListId: 'l1',
          title: 'Work',
          truncated: true,
          tasks: [{ ...item, id: 't2', boardStatus: 'todo', unknownStatusTag: { kind: 'unknown', value: 'blocked' }, due: { kind: 'none' }, parent: { kind: 'subtask', parentId: 't1' }, depth: 1 }],
        },
      ],
    });
  });

  it('returns the tool error text', () => {
    expect(parseListing({ isError: true, content: [{ type: 'text', text: 'Google is not connected' }] })).toEqual({ kind: 'error', message: 'Google is not connected' });
  });

  it('rejects a result that is not the listing shape', () => {
    expect(parseListing(text({ nope: true }))).toMatchObject({ kind: 'error' });
    expect(parseListing({ content: [{ type: 'text', text: 'not json' }] })).toMatchObject({ kind: 'error' });
    expect(parseListing(undefined)).toMatchObject({ kind: 'error' });
  });
});

describe('parseBoardPayload (show_task_board result)', () => {
  it('prefers structuredContent and reads the selection', () => {
    const result = parseBoardPayload({ content: [{ type: 'text', text: 'ignored' }], structuredContent: { lists: [page], selection: { kind: 'list', taskListId: 'l1' } } });

    expect(result).toMatchObject({ kind: 'ok', value: { selection: { kind: 'list', taskListId: 'l1' }, lists: [{ taskListId: 'l1' }] } });
  });

  it('falls back to the JSON text', () => {
    expect(parseBoardPayload(text({ lists: [], selection: { kind: 'all' } }))).toEqual({ kind: 'ok', value: { lists: [], selection: { kind: 'all' } } });
  });
});

describe('parseTask (set_task_status / move_task result)', () => {
  it('reads one task view', () => {
    expect(parseTask(text(wireTask))).toEqual({ kind: 'ok', value: item });
  });

  it('returns the tool error text', () => {
    expect(parseTask({ isError: true, content: [{ type: 'text', text: 'Task not found' }] })).toEqual({ kind: 'error', message: 'Task not found' });
  });
});
