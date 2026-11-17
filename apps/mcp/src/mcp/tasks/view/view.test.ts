import { describe, expect, it } from 'vitest';

import { toTaskListView, toTaskPageView, toTaskView } from './index';

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

describe('toTaskListView / toTaskPageView', () => {
  it('keeps the list id and title', () => {
    expect(toTaskListView({ id: 'l1', title: 'Work', updated: 'u' })).toEqual({ id: 'l1', title: 'Work', updated: 'u' });
  });

  it('carries the next page token or null', () => {
    expect(toTaskPageView('l1', { items: [open], next: { kind: 'more', pageToken: 'p2' } })).toMatchObject({ taskListId: 'l1', nextPageToken: 'p2', tasks: [{ id: 't1' }] });
    expect(toTaskPageView('l1', { items: [], next: { kind: 'last' } }).nextPageToken).toBeNull();
  });
});
