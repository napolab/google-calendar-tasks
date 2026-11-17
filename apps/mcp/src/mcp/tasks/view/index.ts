import { orderTasksHierarchically } from '@napolab/gct-core/tasks';

import type { OrderedTask, Task, TaskAssignment, TaskAssignmentSource, TaskDue, TaskHierarchy, TaskLink, TaskListSummary, TaskPage, TaskPageCursor } from '@napolab/gct-core/tasks';

// Read side: tasks shaped for an LLM (ids always present, dates as YYYY-MM-DD, absent values as null; output only).

export type TaskView = {
  readonly id: string;
  readonly taskListId: string;
  readonly title: string;
  readonly notes: string;
  readonly status: 'needsAction' | 'completed';
  readonly due: string | null;
  readonly parentId: string | null;
  readonly completedAt: string | null;
  readonly position: string;
  readonly updated: string;
  readonly deleted: boolean;
  readonly hidden: boolean;
  readonly links: readonly TaskLink[];
  // null unless the task was assigned to the user from Google Docs / a Chat space.
  readonly assignment: { readonly linkToTask: string; readonly source: TaskAssignmentSource } | null;
};

export type TaskListView = { readonly id: string; readonly title: string; readonly updated: string };

// A task in a listing: `depth` is how many of its ancestors are in the same page (0 = top level, also for a subtask
// whose parent is on another page or filtered out — its parentId still names the parent).
export type ListedTaskView = TaskView & { readonly depth: number };

// One list's page in list_tasks — the same shape whether one list or every list was read.
export type TaskListPageView = {
  readonly taskListId: string;
  readonly title: string;
  readonly tasks: readonly ListedTaskView[];
  readonly nextPageToken: string | null;
};

const dueOf = (due: TaskDue): string | null => {
  switch (due.kind) {
    case 'none':
      return null;
    case 'date':
      return due.date;
    default: {
      const _exhaustive: never = due;
      throw new Error(`unhandled due: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const parentOf = (hierarchy: TaskHierarchy): string | null => {
  switch (hierarchy.kind) {
    case 'root':
      return null;
    case 'subtask':
      return hierarchy.parentId;
    default: {
      const _exhaustive: never = hierarchy;
      throw new Error(`unhandled hierarchy: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const completedAtOf = (task: Task): string | null => {
  switch (task.status) {
    case 'needsAction':
      return null;
    case 'completed':
      return task.completedAt;
    default: {
      const _exhaustive: never = task;
      throw new Error(`unhandled task: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const assignmentOf = (assignment: TaskAssignment): TaskView['assignment'] => {
  switch (assignment.kind) {
    case 'none':
      return null;
    case 'assigned':
      return { linkToTask: assignment.linkToTask, source: assignment.source };
    default: {
      const _exhaustive: never = assignment;
      throw new Error(`unhandled assignment: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const toTaskView = (task: Task): TaskView => ({
  id: task.id,
  taskListId: task.taskListId,
  title: task.title,
  notes: task.notes,
  status: task.status,
  due: dueOf(task.due),
  parentId: parentOf(task.hierarchy),
  completedAt: completedAtOf(task),
  position: task.position,
  updated: task.updated,
  deleted: task.deleted,
  hidden: task.hidden,
  links: task.links,
  assignment: assignmentOf(task.assignment),
});

export const toTaskListView = (list: TaskListSummary): TaskListView => ({ id: list.id, title: list.title, updated: list.updated });

const nextPageTokenOf = (next: TaskPageCursor): string | null => {
  switch (next.kind) {
    case 'last':
      return null;
    case 'more':
      return next.pageToken;
    default: {
      const _exhaustive: never = next;
      throw new Error(`unhandled cursor: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toListedTaskView = ({ task, depth }: OrderedTask): ListedTaskView => ({ ...toTaskView(task), depth });

// Tasks in outline order: each parent followed by its subtasks (core orderTasksHierarchically).
export const toTaskListPageView = (list: TaskListSummary, page: TaskPage): TaskListPageView => ({
  taskListId: list.id,
  title: list.title,
  tasks: orderTasksHierarchically(page.items).map(toListedTaskView),
  nextPageToken: nextPageTokenOf(page.next),
});
