import { resolveTaskList } from '@napolab/gct-core/tasks';

import type { TaskListTasks } from '../all-lists';
import type { Task, TaskDue, TaskHierarchy, TaskListSummary, TaskPage, TaskPageCursor } from '@napolab/gct-core/tasks';

// Human-readable task output: `[ ] title  (due YYYY-MM-DD)  [id]`, subtasks indented, completed ones checked.

const checkbox = (task: Task): string => {
  switch (task.status) {
    case 'needsAction':
      return '[ ]';
    case 'completed':
      return '[x]';
    default: {
      const _exhaustive: never = task;
      throw new Error(`unhandled task: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const indent = (hierarchy: TaskHierarchy): string => {
  switch (hierarchy.kind) {
    case 'root':
      return '';
    case 'subtask':
      return '  ';
    default: {
      const _exhaustive: never = hierarchy;
      throw new Error(`unhandled hierarchy: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const dueSuffix = (due: TaskDue): string => {
  switch (due.kind) {
    case 'none':
      return '';
    case 'date':
      return `  (due ${due.date})`;
    default: {
      const _exhaustive: never = due;
      throw new Error(`unhandled due: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const formatTaskLine = (task: Task): string => `${indent(task.hierarchy)}${checkbox(task)} ${task.title === '' ? '(no title)' : task.title}${dueSuffix(task.due)}  [${task.id}]`;

const nextPageLines = (next: TaskPageCursor): readonly string[] => {
  switch (next.kind) {
    case 'last':
      return [];
    case 'more':
      return [`More tasks: --page-token ${next.pageToken}`];
    default: {
      const _exhaustive: never = next;
      throw new Error(`unhandled cursor: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const formatTaskPage = (page: TaskPage): string => {
  const lines = [...page.items.map(formatTaskLine), ...nextPageLines(page.next)];
  return lines.length === 0 ? 'No tasks.' : lines.join('\n');
};

// ---- every list (`gct tasks list` without --list) ----

const listTitle = (list: TaskListSummary): string => (list.title === '' ? '(no title)' : list.title);

// Characters a POSIX shell would split on or expand.
const SHELL_SPECIAL = /[\s'"\\$`!*?&|;<>(){}[\]#~]/u;

const shellQuote = (value: string): string => (SHELL_SPECIAL.test(value) ? `'${value.replaceAll("'", `'\\''`)}'` : value);

// The title when it alone resolves back to this list, otherwise the id (untitled or duplicated titles).
const listFlagValue = (list: TaskListSummary, all: readonly TaskListSummary[]): string => {
  const namesIt =
    list.title !== '' &&
    resolveTaskList(all, list.title)
      .map((found) => found.id === list.id)
      .unwrapOr(false);
  return namesIt ? shellQuote(list.title) : list.id;
};

const continueLines = (group: TaskListTasks, all: readonly TaskListSummary[]): readonly string[] => {
  switch (group.nextPage.kind) {
    case 'last':
      return [];
    case 'more':
      return [`More tasks: --list ${listFlagValue(group.taskList, all)} --page-token ${group.nextPage.pageToken}`];
    default: {
      const _exhaustive: never = group.nextPage;
      throw new Error(`unhandled cursor: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const isEmpty = (group: TaskListTasks): boolean => group.tasks.length === 0 && group.nextPage.kind === 'last';

const formatGroup = (group: TaskListTasks, all: readonly TaskListSummary[]): string => [`# ${listTitle(group.taskList)}`, ...group.tasks.map(formatTaskLine), ...continueLines(group, all)].join('\n');

export const formatTaskListsTasks = (groups: readonly TaskListTasks[]): string => {
  const all = groups.map((group) => group.taskList);
  const shown = groups.filter((group) => !isEmpty(group));
  return shown.length === 0 ? 'No tasks.' : shown.map((group) => formatGroup(group, all)).join('\n\n');
};
