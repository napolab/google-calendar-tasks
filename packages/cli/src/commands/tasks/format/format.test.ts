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
  links: [],
  assignment: { kind: 'none' },
  deleted: false,
  hidden: false,
};

const DONE: CompletedTask = { ...OPEN, id: 't2', status: 'completed', completedAt: '2026-11-17T03:00:00.000Z', due: { kind: 'none' }, hierarchy: { kind: 'subtask', parentId: 't1' }, title: '' };

describe('formatTaskLine', () => {
  it('shows an open task with its due date and id', () => {
    expect(formatTaskLine(OPEN)).toBe('[ ] Buy milk  (due 2026-11-20)  [t1]');
  });

  it('checks a completed task, indents a subtask and names an untitled one', () => {
    expect(formatTaskLine(DONE)).toBe('  [x] (no title)  [t2]');
  });

  it('marks an open task whose notes tag it [status: doing]', () => {
    expect(formatTaskLine({ ...OPEN, notes: '[status: doing]\nhalf done' })).toBe('[ ] Buy milk  [doing]  (due 2026-11-20)  [t1]');
    expect(formatTaskLine({ ...DONE, notes: '[status: doing]' })).toBe('  [x] (no title)  [t2]');
  });
});

describe('formatTaskPage', () => {
  it('lists tasks and how to get the next page', () => {
    expect(formatTaskPage({ items: [OPEN, DONE], next: { kind: 'more', pageToken: 'tok' } })).toBe('[ ] Buy milk  (due 2026-11-20)  [t1]\n  [x] (no title)  [t2]\nMore tasks: --page-token tok');
  });

  it('says when there are none', () => {
    expect(formatTaskPage({ items: [], next: { kind: 'last' } })).toBe('No tasks.');
  });

  it('lists each parent before its subtasks, indenting two spaces per level', () => {
    // Google's order: by position alone, so subtasks come first.
    const child: OpenTask = { ...OPEN, id: 'c1', title: 'Child', due: { kind: 'none' }, hierarchy: { kind: 'subtask', parentId: 't1' }, position: '00000000000000000000' };
    const grandchild: OpenTask = { ...child, id: 'g1', title: 'Grandchild', hierarchy: { kind: 'subtask', parentId: 'c1' } };
    expect(formatTaskPage({ items: [grandchild, child, OPEN], next: { kind: 'last' } })).toBe('[ ] Buy milk  (due 2026-11-20)  [t1]\n  [ ] Child  [c1]\n    [ ] Grandchild  [g1]');
  });

  it('shows a subtask whose parent is not in the page after the top-level tasks, unindented', () => {
    const orphan: OpenTask = { ...OPEN, id: 'o1', title: 'Orphan', due: { kind: 'none' }, hierarchy: { kind: 'subtask', parentId: 'gone' }, position: '00000000000000000000' };
    expect(formatTaskPage({ items: [orphan, OPEN], next: { kind: 'last' } })).toBe('[ ] Buy milk  (due 2026-11-20)  [t1]\n[ ] Orphan  [o1]');
  });
});

describe('formatTaskListsTasks', () => {
  const list = (id: string, title: string): TaskListSummary => ({ id, title, updated: '2026-11-17T01:00:00.000Z' });
  const group = (taskList: TaskListSummary, tasks: TaskListTasks['tasks'], nextPage: TaskListTasks['nextPage'] = { kind: 'last' }): TaskListTasks => ({ taskList, tasks, nextPage });

  it('groups tasks under a header per list title and skips empty lists', () => {
    const groups = [group(list('MDE', 'マイタスク'), []), group(list('MDI', '日常タスク'), [OPEN]), group(list('MDV', 'VRC'), [DONE])];
    // t2's parent t1 is in another list's group, so t2 is not indented there.
    expect(formatTaskListsTasks(groups)).toBe('# 日常タスク\n[ ] Buy milk  (due 2026-11-20)  [t1]\n\n# VRC\n[x] (no title)  [t2]');
  });

  it('lists each parent before its subtasks within a list, indented under it', () => {
    expect(formatTaskListsTasks([group(list('MDI', '日常タスク'), [DONE, OPEN])])).toBe('# 日常タスク\n[ ] Buy milk  (due 2026-11-20)  [t1]\n  [x] (no title)  [t2]');
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
