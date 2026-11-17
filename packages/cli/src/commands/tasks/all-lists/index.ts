import { ResultAsync } from 'neverthrow';

import type { ListTasksOptions } from '../input';
import type { GoogleError, InvalidInputError } from '@napolab/gct-core/errors';
import type { ITasksService, Task, TaskListSummary, TaskPageCursor } from '@napolab/gct-core/tasks';

// `gct tasks list` without --list: the first page of every task list, read concurrently. The first failing list
// fails the whole command — a partial listing would hide tasks silently.

// One list's share of the listing (also the `--json` shape, one element per list).
export type TaskListTasks = {
  readonly taskList: TaskListSummary;
  readonly tasks: readonly Task[];
  readonly nextPage: TaskPageCursor;
};

const listTasksIn =
  (tasks: ITasksService, options: ListTasksOptions) =>
  (taskList: TaskListSummary): ResultAsync<TaskListTasks, GoogleError | InvalidInputError> =>
    tasks.listTasks({ ...options, taskListId: taskList.id, page: { kind: 'first' } }).map((page) => ({ taskList, tasks: page.items, nextPage: page.next }));

export const listTasksInAllLists = (tasks: ITasksService, options: ListTasksOptions): ResultAsync<readonly TaskListTasks[], GoogleError | InvalidInputError> =>
  tasks.listTaskLists().andThen((lists) => ResultAsync.combine(lists.map(listTasksIn(tasks, options))));
