import { describe, expect, it } from 'vitest';

import { formatTaskLine, formatTaskListsTasks, formatTaskPage } from './index';

import type { TaskListTasks } from '../all-lists';
import type { CompletedTask, OpenTask, TaskListSummary } from '@napolab/gct-core/tasks';

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

describe('formatTaskListsTasks', () => {
  const list = (id: string, title: string): TaskListSummary => ({ id, title, updated: '2026-11-17T01:00:00.000Z' });
  const group = (taskList: TaskListSummary, tasks: TaskListTasks['tasks'], nextPage: TaskListTasks['nextPage'] = { kind: 'last' }): TaskListTasks => ({ taskList, tasks, nextPage });

  it('groups tasks under a header per list title and skips empty lists', () => {
    const groups = [group(list('MDE', 'マイタスク'), []), group(list('MDI', '日常タスク'), [OPEN]), group(list('MDV', 'VRC'), [DONE])];
    expect(formatTaskListsTasks(groups)).toBe('# 日常タスク\n[ ] Buy milk  (due 2026-11-20)  [t1]\n\n# VRC\n  [x] (no title)  [t2]');
  });

  it('tells how to continue a list that has more pages, by title', () => {
    expect(formatTaskListsTasks([group(list('MDI', '日常タスク'), [OPEN], { kind: 'more', pageToken: 'tok' })])).toBe(
      '# 日常タスク\n[ ] Buy milk  (due 2026-11-20)  [t1]\nMore tasks: --list 日常タスク --page-token tok',
    );
  });

  it('quotes a title with spaces in the continuation hint', () => {
    expect(formatTaskListsTasks([group(list('MDV', 'vrc タスク'), [OPEN], { kind: 'more', pageToken: 'tok' })])).toContain("More tasks: --list 'vrc タスク' --page-token tok");
  });

  it('falls back to the list id when the title would not name the list', () => {
    const untitled = group(list('MD0', ''), [OPEN], { kind: 'more', pageToken: 'tok' });
    const twin = group(list('MD2', 'Work'), [OPEN], { kind: 'more', pageToken: 'tok2' });
    const text = formatTaskListsTasks([untitled, group(list('MD1', 'work'), []), twin]);
    expect(text).toContain('# (no title)\n');
    expect(text).toContain('More tasks: --list MD0 --page-token tok');
    expect(text).toContain('More tasks: --list MD2 --page-token tok2');
  });

  it('says when every list is empty, or there are no lists', () => {
    expect(formatTaskListsTasks([group(list('MDE', 'マイタスク'), [])])).toBe('No tasks.');
    expect(formatTaskListsTasks([])).toBe('No tasks.');
  });
});
