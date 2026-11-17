import { describe, expect, it } from 'vitest';

import { toTaskListPageView, toTaskListView, toTaskView } from './index';

import type { Task } from '@napolab/gct-core/tasks';

const open: Task = {
  status: 'needsAction',
  id: 't1',
  taskListId: 'l1',
  title: 'Buy milk',
  notes: '',
  due: { kind: 'date', date: '2026-11-20' },
  hierarchy: { kind: 'subtask', parentId: 'p1' },
  position: '0001',
  updated: '2026-11-17T00:00:00Z',
  webViewLink: 'https://tasks.google.com/task/t1',
  links: [],
  assignment: { kind: 'none' },
  deleted: false,
  hidden: false,
};

describe('toTaskView', () => {
  it('flattens the due date, parent and completion for an LLM', () => {
    expect(toTaskView(open)).toEqual({
      id: 't1',
      taskListId: 'l1',
      title: 'Buy milk',
      notes: '',
      status: 'needsAction',
      due: '2026-11-20',
      parentId: 'p1',
      completedAt: null,
      position: '0001',
      updated: '2026-11-17T00:00:00Z',
      deleted: false,
      hidden: false,
      links: [],
      assignment: null,
    });
  });

  it('exposes links, the deleted / hidden flags and where an assigned task comes from', () => {
    const assigned: Task = {
      ...open,
      deleted: true,
      hidden: true,
      links: [{ type: 'email', description: 'Re: invoice', link: 'https://mail.google.com/x' }],
      assignment: { kind: 'assigned', linkToTask: 'https://docs.google.com/d/1', source: { kind: 'document', driveFileId: 'F1', resourceKey: '' } },
    };
    expect(toTaskView(assigned)).toMatchObject({
      deleted: true,
      hidden: true,
      links: [{ type: 'email', description: 'Re: invoice', link: 'https://mail.google.com/x' }],
      assignment: { linkToTask: 'https://docs.google.com/d/1', source: { kind: 'document', driveFileId: 'F1', resourceKey: '' } },
    });
  });

  it('shows when a completed root task without due date was completed', () => {
    const completed: Task = { ...open, status: 'completed', completedAt: '2026-11-18T00:00:00Z', due: { kind: 'none' }, hierarchy: { kind: 'root' } };
    expect(toTaskView(completed)).toMatchObject({ status: 'completed', completedAt: '2026-11-18T00:00:00Z', due: null, parentId: null });
  });
});

describe('toTaskListView', () => {
  it('keeps the list id and title', () => {
    expect(toTaskListView({ id: 'l1', title: 'Work', updated: 'u' })).toEqual({ id: 'l1', title: 'Work', updated: 'u' });
  });
});

describe('toTaskListPageView', () => {
  const work = { id: 'l1', title: 'Work', updated: 'u' };

  it('names the list and carries the next page token or null', () => {
    const view = toTaskListPageView(work, { items: [open], next: { kind: 'more', pageToken: 'p2' } });
    expect(Object.keys(view)).toEqual(['taskListId', 'title', 'tasks', 'nextPageToken']);
    expect(view).toMatchObject({ taskListId: 'l1', title: 'Work', nextPageToken: 'p2', tasks: [{ id: 't1' }] });
    expect(toTaskListPageView(work, { items: [], next: { kind: 'last' } }).nextPageToken).toBeNull();
  });

  it('lists each parent before its subtasks, with their depth and parentId', () => {
    const parent: Task = { ...open, id: 'p1', hierarchy: { kind: 'root' }, position: '0002' };
    const child: Task = { ...open, id: 'c1', hierarchy: { kind: 'subtask', parentId: 'p1' }, position: '0000' };
    const orphan: Task = { ...open, id: 'o1', hierarchy: { kind: 'subtask', parentId: 'gone' }, position: '0000' };

    const view = toTaskListPageView(work, { items: [child, orphan, parent], next: { kind: 'last' } });

    expect(view.tasks.map((task) => [task.id, task.parentId, task.depth])).toEqual([
      ['p1', null, 0],
      ['c1', 'p1', 1],
      ['o1', 'gone', 0],
    ]);
  });
});
