import { validateDeletableTaskListId, validateTaskListTitle } from '@napolab/gct-core/tasks';

import { jsonArg } from '../../shared/flags/json';
import { toListTarget } from '../../tasks/input';

import type { Targeted } from '../../tasks/input';
import type { InvalidInputError } from '@napolab/gct-core/errors';
import type { CreateTaskListInput, RenameTaskListInput } from '@napolab/gct-core/tasks';
import type { Args } from 'gunshi';
import type { Result } from 'neverthrow';

// `gct tasklists add|rename|delete` arguments and their mapping to core inputs. Pure. Titles and the
// undeletable default list are checked here (with core's validators) so input errors win over "not logged in"
// and no lookup runs for input that core would reject anyway. `<list>` stays unresolved: the command looks
// it up (../../tasks/task-list) once the input is valid.

const LIST_VALUE = "a task list title or id (see 'gct tasklists')";

const titleArg = (description: string) => ({ title: { type: 'positional', description } }) satisfies Args;

export const addTaskListArgs = { ...titleArg('Title of the new task list (quote it when it has spaces)'), ...jsonArg } satisfies Args;

export const renameTaskListArgs = {
  list: { type: 'positional', description: `The task list to rename: ${LIST_VALUE}, or @default` },
  ...titleArg('New title (quote it when it has spaces)'),
  ...jsonArg,
} satisfies Args;

export const deleteTaskListArgs = {
  list: { type: 'positional', description: `The task list to delete with every task in it: ${LIST_VALUE}. The default list cannot be deleted` },
  ...jsonArg,
} satisfies Args;

export const toCreateTaskListInput = (title: string): Result<CreateTaskListInput, InvalidInputError> => validateTaskListTitle(title).map((valid) => ({ title: valid }));

export const toRenameTaskListInput = (list: string, title: string): Result<Targeted<RenameTaskListInput>, InvalidInputError> =>
  validateTaskListTitle(title).map((valid) => ({ list: toListTarget(list), input: { title: valid } }));

// The title or id of the list to delete; `@default` is rejected before any lookup.
export const toDeleteTaskListName = (list: string): Result<string, InvalidInputError> => validateDeletableTaskListId(list);
