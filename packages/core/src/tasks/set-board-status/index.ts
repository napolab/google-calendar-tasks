import { okAsync } from 'neverthrow';

import { writeStatusTag } from '../status-tag';

import type { GoogleError, InvalidInputError } from '../../errors';
import type { ITasksService, Task, TaskRef } from '../index';
import type { TaskBoardStatus } from '../status-tag';
import type { ResultAsync } from 'neverthrow';

// Moves a task to a board column (status-tag template): Google's completion first — it decides the column on its own,
// so a failure after it still leaves the task where Google shows it — then the first-line tag of the notes the status
// call returned (fresh, so a concurrent notes edit is not overwritten by a stale copy). The notes are written only when
// the tag changes.

const changeCompletion = (tasks: ITasksService, ref: TaskRef, status: TaskBoardStatus): ResultAsync<Task, GoogleError> => {
  switch (status) {
    case 'done':
      return tasks.completeTask(ref);
    case 'todo':
    case 'doing':
      return tasks.reopenTask(ref);
    default: {
      const _exhaustive: never = status;
      throw new Error(`unhandled board status: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const retag = (tasks: ITasksService, ref: TaskRef, task: Task, status: TaskBoardStatus): ResultAsync<Task, GoogleError | InvalidInputError> => {
  const notes = writeStatusTag(task.notes, status);
  if (notes === task.notes) return okAsync(task);
  return tasks.updateTask({ ...ref, title: { kind: 'keep' }, notes: { kind: 'set', value: notes }, due: { kind: 'keep' } });
};

export const setTaskBoardStatus = (tasks: ITasksService, ref: TaskRef, status: TaskBoardStatus): ResultAsync<Task, GoogleError | InvalidInputError> =>
  changeCompletion(tasks, ref, status).andThen((task) => retag(tasks, ref, task, status));
