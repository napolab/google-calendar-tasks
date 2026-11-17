import type { Task, TaskDue, TaskHierarchy, TaskPage, TaskPageCursor } from '@napolab/gct-core/tasks';

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
