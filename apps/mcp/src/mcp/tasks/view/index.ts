import type { Task, TaskDue, TaskHierarchy, TaskListSummary, TaskPage, TaskPageCursor } from '@napolab/gct-core/tasks';

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
};

export type TaskListView = { readonly id: string; readonly title: string; readonly updated: string };

export type TaskPageView = { readonly taskListId: string; readonly tasks: readonly TaskView[]; readonly nextPageToken: string | null };

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

export const toTaskPageView = (taskListId: string, page: TaskPage): TaskPageView => ({ taskListId, tasks: page.items.map(toTaskView), nextPageToken: nextPageTokenOf(page.next) });
