import { orderTasksHierarchically, resolveTaskList } from '@napolab/gct-core/tasks';

import type { TaskListTasks } from '../all-lists';
import type { OrderedTask, Task, TaskDue, TaskHierarchy, TaskListSummary, TaskPage, TaskPageCursor } from '@napolab/gct-core/tasks';

// Human-readable task output: `[ ] title  (due YYYY-MM-DD)  [id]`, subtasks indented, completed ones checked.
// Listings are in outline order (each parent followed by its subtasks, two spaces per level).

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

const taskText = (task: Task): string => `${checkbox(task)} ${task.title === '' ? '(no title)' : task.title}${dueSuffix(task.due)}  [${task.id}]`;

// One task on its own (add / update / complete / reopen): a subtask is indented once.
export const formatTaskLine = (task: Task): string => `${indent(task.hierarchy)}${taskText(task)}`;

// A task in a listing: indented by its depth in the outline (a subtask whose parent is not listed stays at the top level).
const formatOutlineLine = ({ task, depth }: OrderedTask): string => `${'  '.repeat(depth)}${taskText(task)}`;

const formatOutline = (tasks: readonly Task[]): readonly string[] => orderTasksHierarchically(tasks).map(formatOutlineLine);

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
  const lines = [...formatOutline(page.items), ...nextPageLines(page.next)];
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

const formatGroup = (group: TaskListTasks, all: readonly TaskListSummary[]): string => [`# ${listTitle(group.taskList)}`, ...formatOutline(group.tasks), ...continueLines(group, all)].join('\n');

export const formatTaskListsTasks = (groups: readonly TaskListTasks[]): string => {
  const all = groups.map((group) => group.taskList);
  const shown = groups.filter((group) => !isEmpty(group));
  return shown.length === 0 ? 'No tasks.' : shown.map((group) => formatGroup(group, all)).join('\n\n');
};
