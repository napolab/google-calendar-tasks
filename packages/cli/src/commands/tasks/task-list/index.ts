import { DEFAULT_TASK_LIST_ID, resolveTaskList } from '@napolab/gct-core/tasks';
import { okAsync } from 'neverthrow';

import type { ListTarget, Targeted } from '../input';
import type { AmbiguousTaskListError, GoogleError, TaskListNotFoundError } from '@napolab/gct-core/errors';
import type { ITasksService, TaskListSummary } from '@napolab/gct-core/tasks';
import type { ResultAsync } from 'neverthrow';

// `--list <title or id>` → the task list id core takes. The default list needs no lookup; a name is matched
// against the user's lists by core's resolveTaskList (exact id first, then title).

export type ResolveListError = GoogleError | TaskListNotFoundError | AmbiguousTaskListError;

// A title or id → the whole list (for commands that print which list they acted on).
export const resolveNamedTaskList = (tasks: ITasksService, name: string): ResultAsync<TaskListSummary, ResolveListError> => tasks.listTaskLists().andThen((lists) => resolveTaskList(lists, name));

export const resolveListTarget = (tasks: ITasksService, target: ListTarget): ResultAsync<string, ResolveListError> => {
  switch (target.kind) {
    case 'default':
      return okAsync(DEFAULT_TASK_LIST_ID);
    case 'named':
      return resolveNamedTaskList(tasks, target.name).map((list) => list.id);
    default: {
      const _exhaustive: never = target;
      throw new Error(`unhandled list target: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// The core input with its list resolved to an id.
export const resolveTargeted = <T extends object>(tasks: ITasksService, targeted: Targeted<T>): ResultAsync<Omit<T, 'taskListId'> & { readonly taskListId: string }, ResolveListError> =>
  resolveListTarget(tasks, targeted.list).map((taskListId) => ({ ...targeted.input, taskListId }));
