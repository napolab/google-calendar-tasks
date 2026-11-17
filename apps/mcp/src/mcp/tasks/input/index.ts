import { dayjs } from '@napolab/gct-core/dayjs';
import { InvalidInputError } from '@napolab/gct-core/errors';
import { DEFAULT_TASK_LIST_ID } from '@napolab/gct-core/tasks';
import { Result, err, ok } from 'neverthrow';
import { z } from 'zod';

import { parseDate } from '../../time-input';

import type {
  CreateTaskInput,
  FieldPatch,
  KeepOrSet,
  ListTasksInput,
  TaskDue,
  TaskDueFilter,
  TaskPageRequest,
  TaskPlacement,
  TaskRef,
  TaskSiblingPosition,
  UpdateTaskInput,
} from '@napolab/gct-core/tasks';

// Tasks tool arguments (zod schemas) and their mapping to core inputs. `list` stays unresolved here: a title or id
// is looked up by the handler (core resolveTaskList) once the arguments are valid. Same defaults as the CLI:
// every list when `list` is omitted, completed tasks included, 100 per list.

const DEFAULT_PAGE_SIZE = 100;

// ---- schemas ----

const listArg = z.string().min(1).optional().describe("Task list: an id or a title from list_task_lists, or '@default'. Default: the user's default list.");

const taskIdArg = z.string().min(1).describe('Task id from list_tasks.');

const dateArg = (meaning: string) => z.string().optional().describe(`${meaning} (YYYY-MM-DD; Google Tasks has no due time).`);

export const listTasksArgs = z.strictObject({
  list: z.string().min(1).optional().describe("Only this task list (an id, a title, or '@default'). Default: EVERY list, grouped by list."),
  dueFrom: dateArg('Only tasks due on or after this day'),
  dueTo: dateArg('Only tasks due on or before this day'),
  completed: z
    .enum(['exclude', 'include', 'includeHidden'])
    .optional()
    .describe("Completed tasks: 'exclude', 'include' (default), or 'includeHidden' (also tasks completed in Google's own apps, which Google hides)."),
  maxResults: z.number().int().min(1).max(100).optional().describe(`Tasks per list, 1-100. Default: ${DEFAULT_PAGE_SIZE}.`),
  pageToken: z.string().min(1).optional().describe('nextPageToken of one list from a previous list_tasks call; needs the same list.'),
});

export const taskRefArgs = z.strictObject({ taskId: taskIdArg, list: listArg });

export const createTaskArgs = z.strictObject({
  title: z.string().describe('Task title (non-empty).'),
  list: listArg,
  notes: z.string().optional(),
  due: dateArg('Due day'),
  parentId: z.string().min(1).optional().describe('Create as a subtask of this task id.'),
  previousId: z.string().min(1).optional().describe('Place after this sibling task id. Default: first.'),
});

export const updateTaskArgs = z.strictObject({
  taskId: taskIdArg,
  list: listArg,
  title: z.string().optional().describe('New title (non-empty). Omit to keep.'),
  notes: z.string().optional().describe('New notes. Omit to keep; use clearNotes to remove.'),
  clearNotes: z.boolean().optional().describe('true removes the notes.'),
  due: dateArg('New due day. Omit to keep; use clearDue to remove'),
  clearDue: z.boolean().optional().describe('true removes the due date.'),
});

export type ListTasksArgs = z.output<typeof listTasksArgs>;
export type TaskRefArgs = z.output<typeof taskRefArgs>;
export type CreateTaskArgs = z.output<typeof createTaskArgs>;
export type UpdateTaskArgs = z.output<typeof updateTaskArgs>;

// ---- shared ----

// The list a call addresses: Google's default list (no lookup needed), or a title / id to resolve.
export type ListTarget = { readonly kind: 'default' } | { readonly kind: 'named'; readonly name: string };

// A core input without its task list, and the list it goes to once resolved.
export type Targeted<T> = { readonly list: ListTarget; readonly input: Omit<T, 'taskListId'> };

const toListTarget = (list: string | undefined): ListTarget => (list === undefined || list === DEFAULT_TASK_LIST_ID ? { kind: 'default' } : { kind: 'named', name: list });

const parseOptionalDate = (arg: string, value: string | undefined): Result<string | undefined, InvalidInputError> => (value === undefined ? ok(undefined) : parseDate(arg, value));

const requireTitle = (title: string): Result<string, InvalidInputError> => (title.trim() === '' ? err(new InvalidInputError('title is empty. Pass a non-empty task title.')) : ok(title));

export const toTaskRef = (args: TaskRefArgs): Targeted<TaskRef> => ({ list: toListTarget(args.list), input: { taskId: args.taskId } });

// ---- list ----

// The filters applied to each list that is read.
export type ListTasksOptions = Omit<ListTasksInput, 'taskListId' | 'page'>;

// Without `list` every list is read (first page each); a page token only continues one list.
export type ListTasksQuery =
  | { readonly kind: 'all'; readonly options: ListTasksOptions }
  | { readonly kind: 'one'; readonly list: ListTarget; readonly page: TaskPageRequest; readonly options: ListTasksOptions };

const toDueFilter = (dueMin: string | undefined, dueMax: string | undefined): Result<TaskDueFilter, InvalidInputError> => {
  if (dueMin === undefined) return ok(dueMax === undefined ? { kind: 'any' } : { kind: 'until', dueMax });
  if (dueMax === undefined) return ok({ kind: 'from', dueMin });
  if (dayjs.utc(dueMax).isBefore(dayjs.utc(dueMin))) return err(new InvalidInputError(`dueTo "${dueMax}" is before dueFrom "${dueMin}". Both are inclusive days; pass a dueTo on or after dueFrom.`));
  return ok({ kind: 'between', dueMin, dueMax });
};

const toPageRequest = (pageToken: string | undefined): TaskPageRequest => (pageToken === undefined ? { kind: 'first' } : { kind: 'token', pageToken });

const toScope = (args: ListTasksArgs, options: ListTasksOptions): Result<ListTasksQuery, InvalidInputError> => {
  if (args.list !== undefined) return ok({ kind: 'one', list: toListTarget(args.list), page: toPageRequest(args.pageToken), options });
  if (args.pageToken === undefined) return ok({ kind: 'all', options });
  return err(
    new InvalidInputError(
      `pageToken "${args.pageToken}" needs list: a page token continues one task list. Pass the taskListId of the list it came from as list, or drop pageToken to list every list.`,
    ),
  );
};

export const toListTasksQuery = (args: ListTasksArgs): Result<ListTasksQuery, InvalidInputError> =>
  parseOptionalDate('dueFrom', args.dueFrom).andThen((dueMin) =>
    parseOptionalDate('dueTo', args.dueTo).andThen((dueMax) =>
      toDueFilter(dueMin, dueMax).andThen((due) => toScope(args, { due, completed: args.completed ?? 'include', maxResults: args.maxResults ?? DEFAULT_PAGE_SIZE })),
    ),
  );

// ---- create ----

const toPlacement = (args: CreateTaskArgs): TaskPlacement => {
  const position: TaskSiblingPosition = args.previousId === undefined ? { kind: 'first' } : { kind: 'after', previousId: args.previousId };
  return args.parentId === undefined ? { kind: 'root', position } : { kind: 'subtask', parentId: args.parentId, position };
};

const toDue = (due: string | undefined): TaskDue => (due === undefined ? { kind: 'none' } : { kind: 'date', date: due });

export const toCreateTaskInput = (args: CreateTaskArgs): Result<Targeted<CreateTaskInput>, InvalidInputError> =>
  requireTitle(args.title).andThen((title) =>
    parseOptionalDate('due', args.due).map((due): Targeted<CreateTaskInput> => ({
      list: toListTarget(args.list),
      input: { title, notes: args.notes ?? '', due: toDue(due), placement: toPlacement(args) },
    })),
  );

// ---- update ----

// `<field>` sets, `clear<Field>: true` removes, neither keeps. Both, or an empty value, are rejected.
const toFieldPatch = (field: string, clearArg: string, value: string | undefined, clear: boolean | undefined): Result<FieldPatch<string>, InvalidInputError> => {
  if (value !== undefined && clear === true) return err(new InvalidInputError(`Pass either ${field} (to change it) or ${clearArg}: true (to remove it), not both.`));
  if (clear === true) return ok({ kind: 'clear' });
  if (value === undefined) return ok({ kind: 'keep' });
  if (value === '') return err(new InvalidInputError(`${field} is empty. Pass a non-empty value to change it, or ${clearArg}: true to remove it.`));
  return ok({ kind: 'set', value });
};

const toTitlePatch = (title: string | undefined): Result<KeepOrSet<string>, InvalidInputError> =>
  title === undefined ? ok({ kind: 'keep' }) : requireTitle(title).map((value): KeepOrSet<string> => ({ kind: 'set', value }));

const toDuePatch = (args: UpdateTaskArgs): Result<FieldPatch<string>, InvalidInputError> =>
  toFieldPatch('due', 'clearDue', args.due, args.clearDue).andThen((patch) =>
    patch.kind === 'set' ? parseDate('due', patch.value).map((value): FieldPatch<string> => ({ kind: 'set', value })) : ok(patch),
  );

type UpdateTaskChange = Omit<UpdateTaskInput, 'taskListId'>;

const requireChange = (input: UpdateTaskChange): Result<UpdateTaskChange, InvalidInputError> => {
  if ([input.title, input.notes, input.due].some((patch) => patch.kind !== 'keep')) return ok(input);
  return err(
    new InvalidInputError(
      `Nothing to update for task "${input.taskId}": pass at least one of title, notes / clearNotes, due (YYYY-MM-DD) / clearDue. To change the status use complete_task or reopen_task.`,
    ),
  );
};

export const toUpdateTaskInput = (args: UpdateTaskArgs): Result<Targeted<UpdateTaskInput>, InvalidInputError> =>
  Result.combine([toTitlePatch(args.title), toFieldPatch('notes', 'clearNotes', args.notes, args.clearNotes), toDuePatch(args)])
    .map(([title, notes, due]): UpdateTaskChange => ({ taskId: args.taskId, title, notes, due }))
    .andThen(requireChange)
    .map((input) => ({ list: toListTarget(args.list), input }));
