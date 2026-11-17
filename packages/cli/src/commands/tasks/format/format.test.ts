import { describe, expect, it } from 'vitest';

import { formatTaskLine, formatTaskPage } from './index';

import type { CompletedTask, OpenTask } from '@napolab/gct-core/tasks';

const OPEN: OpenTask = {
  status: 'needsAction',
  id: 't1',
  taskListId: '@default',
  title: 'Buy milk',
  notes: '',
  due: { kind: 'date', date: '2026-11-20' },
  hierarchy: { kind: 'root' },
  position: '00000000000000000001',
  updated: '2026-11-17T01:00:00.000Z',
  webViewLink: 'https://tasks.google.com/task/t1',
};

const DONE: CompletedTask = { ...OPEN, id: 't2', status: 'completed', completedAt: '2026-11-17T03:00:00.000Z', due: { kind: 'none' }, hierarchy: { kind: 'subtask', parentId: 't1' }, title: '' };

describe('formatTaskLine', () => {
  it('shows an open task with its due date and id', () => {
    expect(formatTaskLine(OPEN)).toBe('[ ] Buy milk  (due 2026-11-20)  [t1]');
  });

  it('checks a completed task, indents a subtask and names an untitled one', () => {
    expect(formatTaskLine(DONE)).toBe('  [x] (no title)  [t2]');
  });
});

describe('formatTaskPage', () => {
  it('lists tasks and how to get the next page', () => {
    expect(formatTaskPage({ items: [OPEN, DONE], next: { kind: 'more', pageToken: 'tok' } })).toBe('[ ] Buy milk  (due 2026-11-20)  [t1]\n  [x] (no title)  [t2]\nMore tasks: --page-token tok');
  });

  it('says when there are none', () => {
    expect(formatTaskPage({ items: [], next: { kind: 'last' } })).toBe('No tasks.');
  });
});
