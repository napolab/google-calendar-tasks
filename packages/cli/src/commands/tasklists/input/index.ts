import { validateDeletableTaskListId, validateTaskListTitle } from '@napolab/gct-core/tasks';

import { toListTarget } from '../../tasks/input';

import type { Targeted } from '../../tasks/input';
import type { InvalidInputError } from '@napolab/gct-core/errors';
import type { CreateTaskListInput, RenameTaskListInput } from '@napolab/gct-core/tasks';
import type { Result } from 'neverthrow';

// `gct tasklists add|rename|delete` arguments and their mapping to core inputs. Pure. Titles and the
// undeletable default list are checked here (with core's validators) so input errors win over "not logged in"
// and no lookup runs for input that core would reject anyway. `<list>` stays unresolved: the command looks
// it up (../../tasks/task-list) once the input is valid.

export const toCreateTaskListInput = (title: string): Result<CreateTaskListInput, InvalidInputError> => validateTaskListTitle(title).map((valid) => ({ title: valid }));

export const toRenameTaskListInput = (list: string, title: string): Result<Targeted<RenameTaskListInput>, InvalidInputError> =>
  validateTaskListTitle(title).map((valid) => ({ list: toListTarget(list), input: { title: valid } }));

// The title or id of the list to delete; `@default` is rejected before any lookup.
export const toDeleteTaskListName = (list: string): Result<string, InvalidInputError> => validateDeletableTaskListId(list);
