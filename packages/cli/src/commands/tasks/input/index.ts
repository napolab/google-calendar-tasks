import { InvalidInputError } from '@napolab/gct-core/errors';
import { DEFAULT_TASK_LIST_ID } from '@napolab/gct-core/tasks';
import { err, ok } from 'neverthrow';

import { parseDate } from '../../shared/flags/date';
import { toKeepOrSet, toTextPatch } from '../../shared/flags/patch';

import type { AddTaskValues, CompleteTaskValues, ListTasksValues, UpdateTaskValues } from '../index';
import type {
  CompletedTasksFilter,
  CreateTaskInput,
  FieldPatch,
  ListTasksInput,
  TaskDueFilter,
  TaskPageRequest,
  TaskPlacement,
  TaskRef,
  TaskSiblingPosition,
  UpdateTaskInput,
} from '@napolab/gct-core/tasks';
import type { Result } from 'neverthrow';

// `gct tasks ...` flags (declared by the commands in ../index) and their mapping to core tasks inputs. Pure. CLI defaults (include completed tasks,
// 100 per page) live here because core inputs are required unions. `--list` stays unresolved here: a title or id
// is looked up by the command (../task-list) once the input is valid.

type CompletedChoice = ListTasksValues['completed'];

type Flags<V> = Omit<V, 'taskId' | 'title' | 'json'>;

export type ListTasksFlags = Flags<ListTasksValues>;
export type AddTaskFlags = Flags<AddTaskValues>;
export type UpdateTaskFlags = Omit<UpdateTaskValues, 'taskId' | 'json'>;
export type TaskRefFlags = Flags<CompleteTaskValues>;

// ---- shared ----

// The list a command addresses: Google's default list (no lookup needed), or a `--list` title / id to resolve.
export type ListTarget = { readonly kind: 'default' } | { readonly kind: 'named'; readonly name: string };

// A core input without its task list, and the list it goes to once resolved.
export type Targeted<T> = { readonly list: ListTarget; readonly input: Omit<T, 'taskListId'> };

export const toListTarget = (list: string | undefined): ListTarget => (list === undefined || list === DEFAULT_TASK_LIST_ID ? { kind: 'default' } : { kind: 'named', name: list });

const parseOptionalDate = (flag: string, value: string | undefined): Result<string | undefined, InvalidInputError> => (value === undefined ? ok(undefined) : parseDate(flag, value));

export const toTaskRef = (taskId: string, flags: TaskRefFlags): Targeted<TaskRef> => ({ list: toListTarget(flags.list), input: { taskId } });

// ---- list ----

const COMPLETED_FILTER = { exclude: 'exclude', include: 'include', hidden: 'includeHidden' } satisfies Record<CompletedChoice, CompletedTasksFilter>;

const toDueFilter = (dueMin: string | undefined, dueMax: string | undefined): TaskDueFilter => {
  if (dueMin === undefined) return dueMax === undefined ? { kind: 'any' } : { kind: 'until', dueMax };
  return dueMax === undefined ? { kind: 'from', dueMin } : { kind: 'between', dueMin, dueMax };
};

// The `tasks list` filters applied to each list it reads.
export type ListTasksOptions = Omit<ListTasksInput, 'taskListId' | 'page'>;

// Without --list every list is read (first page each); a page token only continues one list.
export type ListTasksQuery =
  | { readonly kind: 'all'; readonly options: ListTasksOptions }
  | { readonly kind: 'one'; readonly list: ListTarget; readonly page: TaskPageRequest; readonly options: ListTasksOptions };

const toPageRequest = (pageToken: string | undefined): TaskPageRequest => (pageToken === undefined ? { kind: 'first' } : { kind: 'token', pageToken });

const toListScope = (flags: ListTasksFlags, options: ListTasksOptions): Result<ListTasksQuery, InvalidInputError> => {
  if (flags.list !== undefined) return ok({ kind: 'one', list: toListTarget(flags.list), page: toPageRequest(flags.pageToken), options });
  if (flags.pageToken === undefined) return ok({ kind: 'all', options });
  return err(
    new InvalidInputError(
      `--page-token "${flags.pageToken}" needs --list: a page token continues one task list. Pass the same --list as the listing that printed the token (e.g. gct tasks list --list <title or id> --page-token <token>), or drop --page-token to list every list.`,
    ),
  );
};

export const toListTasksQuery = (flags: ListTasksFlags): Result<ListTasksQuery, InvalidInputError> =>
  parseOptionalDate('--due-from', flags.dueFrom).andThen((dueMin) =>
    parseOptionalDate('--due-to', flags.dueTo).andThen((dueMax) =>
      toListScope(flags, {
        due: toDueFilter(dueMin, dueMax),
        completed: COMPLETED_FILTER[flags.completed],
        completedAt: { kind: 'any' },
        updated: { kind: 'any' },
        deleted: 'exclude',
        assigned: 'exclude',
        maxResults: flags.max,
      }),
    ),
  );

// ---- add ----

const toSiblingPosition = (after: string | undefined): TaskSiblingPosition => (after === undefined ? { kind: 'first' } : { kind: 'after', previousId: after });

const toPlacement = (flags: AddTaskFlags): TaskPlacement => {
  const position = toSiblingPosition(flags.after);
  return flags.parent === undefined ? { kind: 'root', position } : { kind: 'subtask', parentId: flags.parent, position };
};

export const toCreateTaskInput = (title: string, flags: AddTaskFlags): Result<Targeted<CreateTaskInput>, InvalidInputError> =>
  parseOptionalDate('--due', flags.due).map((due) => ({
    list: toListTarget(flags.list),
    input: {
      title,
      notes: flags.notes ?? '',
      due: due === undefined ? { kind: 'none' } : { kind: 'date', date: due },
      placement: toPlacement(flags),
    },
  }));

// ---- update ----

// `--due` is checked as a date only when it sets one.
const validateDuePatch = (patch: FieldPatch<string>): Result<FieldPatch<string>, InvalidInputError> => {
  switch (patch.kind) {
    case 'keep':
    case 'clear':
      return ok(patch);
    case 'set':
      return parseDate('--due', patch.value).map((value) => ({ kind: 'set', value }));
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type UpdateTaskChange = Omit<UpdateTaskInput, 'taskListId'>;

const requireChange = (input: UpdateTaskChange): Result<UpdateTaskChange, InvalidInputError> => {
  if ([input.title, input.notes, input.due].some((patch) => patch.kind !== 'keep')) return ok(input);
  return err(
    new InvalidInputError(
      `Nothing to update for task "${input.taskId}". Pass at least one of --title, --notes / --clear-notes, --due YYYY-MM-DD / --clear-due. To change the status use \`gct tasks complete\` or \`gct tasks reopen\`.`,
    ),
  );
};

export const toUpdateTaskInput = (taskId: string, flags: UpdateTaskFlags): Result<Targeted<UpdateTaskInput>, InvalidInputError> =>
  toKeepOrSet('title', flags.title).andThen((title) =>
    toTextPatch('notes', flags.notes, flags.clearNotes).andThen((notes) =>
      toTextPatch('due', flags.due, flags.clearDue)
        .andThen(validateDuePatch)
        .map((due): UpdateTaskChange => ({ taskId, title, notes, due }))
        .andThen(requireChange)
        .map((input) => ({ list: toListTarget(flags.list), input })),
    ),
  );
