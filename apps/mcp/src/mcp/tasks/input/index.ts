import { dayjs } from '@napolab/gct-core/dayjs';
import { InvalidInputError } from '@napolab/gct-core/errors';
import { DEFAULT_TASK_LIST_ID, validateClearableTaskListId, validateDeletableTaskListId, validateTaskListTitle } from '@napolab/gct-core/tasks';
import { Result, err, ok } from 'neverthrow';
import { z } from 'zod';

import { parseDate, parseWindowBound, toWindowEnd, toWindowStart } from '../../time-input';

import type { WindowBound } from '../../time-input';
import type {
  CompletedAtFilter,
  CreateTaskInput,
  CreateTaskListInput,
  FieldPatch,
  KeepOrSet,
  ListTasksInput,
  MoveTaskInput,
  RenameTaskListInput,
  TaskDue,
  TaskDueFilter,
  TaskPageRequest,
  TaskPlacement,
  TaskRef,
  TaskSiblingPosition,
  TaskUpdatedFilter,
  UpdateTaskInput,
} from '@napolab/gct-core/tasks';

// Tasks tool arguments (zod schemas) and their mapping to core inputs. `list` stays unresolved here: a title or id
// is looked up by the handler (core findTaskList: by id first, then by title) once the arguments are valid. Same defaults as the CLI:
// every list when `list` is omitted, completed tasks included, 100 per list.

const DEFAULT_PAGE_SIZE = 100;

// ---- schemas ----

const listArg = z.string().min(1).optional().describe("Task list: an id or a title from list_task_lists, or '@default'. Default: the user's default list.");

const taskIdArg = z.string().min(1).describe('Task id from list_tasks.');

const instantArg = (meaning: string) => z.string().optional().describe(`${meaning}: RFC 3339 with an offset (e.g. 2026-11-17T09:00:00+09:00), or YYYY-MM-DD (a day in Asia/Tokyo).`);

const dateArg = (meaning: string) => z.string().optional().describe(`${meaning} (YYYY-MM-DD; Google Tasks has no due time).`);

export const listTasksArgs = z.strictObject({
  list: z.string().min(1).optional().describe("Only this task list (an id, a title, or '@default'). Default: EVERY list, grouped by list."),
  dueFrom: dateArg('Only tasks due on or after this day'),
  dueTo: dateArg('Only tasks due on or before this day'),
  completed: z
    .enum(['exclude', 'include', 'includeHidden'])
    .optional()
    .describe("Completed tasks: 'exclude', 'include' (default), or 'includeHidden' (also tasks completed in Google's own apps, which Google hides)."),
  completedMin: instantArg('Only tasks completed at or after this (inclusive; a day: from its start). Needs completed tasks'),
  completedMax: instantArg('Upper bound on the completion time (a day: up to the end of that day). Needs completed tasks'),
  updatedMin: instantArg('Only tasks modified at or after this (inclusive; a day: from its start)'),
  showDeleted: z.boolean().optional().describe('true also returns deleted tasks (deleted: true). Default: false.'),
  showAssigned: z.boolean().optional().describe('true also returns tasks assigned to the user from Google Docs / Chat spaces. Default: false.'),
  maxResults: z.number().int().min(1).max(100).optional().describe(`Tasks per list, 1-100. Default: ${DEFAULT_PAGE_SIZE}.`),
  pageToken: z.string().min(1).optional().describe('nextPageToken of one list from a previous list_tasks call; needs the same list.'),
});

export const taskRefArgs = z.strictObject({ taskId: taskIdArg, list: listArg });

export const getTaskListArgs = z.strictObject({
  list: z.string().min(1).describe("The task list: an id or a title from list_task_lists, or '@default'."),
});

export const moveTaskArgs = z.strictObject({
  taskId: taskIdArg,
  list: z.string().min(1).optional().describe("The list the task is in now: an id or a title from list_task_lists, or '@default'. Default: the user's default list."),
  destinationList: z.string().min(1).optional().describe("Move it into this task list (an id, a title, or '@default'). Default: stay in the current list."),
  parentId: z.string().min(1).optional().describe('Make it a subtask of this task id (in the destination list). Omit to put it at the top level — this un-nests a subtask.'),
  previousId: z.string().min(1).optional().describe('Place it right after this sibling task id. Omit to place it first among its siblings.'),
});

export const clearCompletedTasksArgs = z.strictObject({
  list: z.string().min(1).describe("The task list to clear: an id or a title from list_task_lists, or '@default'."),
  confirm: z.literal('clear-completed').describe("Must be exactly 'clear-completed': confirms hiding every completed task of the list."),
});

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

const taskListTitleArg = z.string().describe('Task list title (non-empty, at most 1024 characters).');

export const createTaskListArgs = z.strictObject({ title: taskListTitleArg });

export const renameTaskListArgs = z.strictObject({
  list: z.string().min(1).describe("The task list to rename: an id or a title from list_task_lists, or '@default'."),
  title: taskListTitleArg.describe('New task list title (non-empty, at most 1024 characters).'),
});

export const deleteTaskListArgs = z.strictObject({
  list: z.string().min(1).describe("The task list to delete: an id (preferred) or a title from list_task_lists. '@default' is rejected: the default list cannot be deleted."),
});

export type ListTasksArgs = z.output<typeof listTasksArgs>;
export type TaskRefArgs = z.output<typeof taskRefArgs>;
export type GetTaskListArgs = z.output<typeof getTaskListArgs>;
export type MoveTaskArgs = z.output<typeof moveTaskArgs>;
export type ClearCompletedTasksArgs = z.output<typeof clearCompletedTasksArgs>;
export type CreateTaskArgs = z.output<typeof createTaskArgs>;
export type UpdateTaskArgs = z.output<typeof updateTaskArgs>;
export type CreateTaskListArgs = z.output<typeof createTaskListArgs>;
export type RenameTaskListArgs = z.output<typeof renameTaskListArgs>;
export type DeleteTaskListArgs = z.output<typeof deleteTaskListArgs>;

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

const parseOptionalBound = (arg: string, value: string | undefined): Result<WindowBound | undefined, InvalidInputError> => (value === undefined ? ok(undefined) : parseWindowBound(arg, value));

const toUpdatedFilter = (args: ListTasksArgs): Result<TaskUpdatedFilter, InvalidInputError> =>
  parseOptionalBound('updatedMin', args.updatedMin).map((bound): TaskUpdatedFilter => (bound === undefined ? { kind: 'any' } : { kind: 'since', updatedMin: toWindowStart(bound) }));

// A day as completedMin starts at its midnight; a day as completedMax is inclusive (ends at the next midnight).
const toCompletedRange = (args: ListTasksArgs, min: WindowBound | undefined, max: WindowBound | undefined): Result<CompletedAtFilter, InvalidInputError> => {
  if (min === undefined) return ok(max === undefined ? { kind: 'any' } : { kind: 'until', completedMax: toWindowEnd(max) });
  if (max === undefined) return ok({ kind: 'from', completedMin: toWindowStart(min) });
  const [completedMin, completedMax] = [toWindowStart(min), toWindowEnd(max)];
  if (dayjs(completedMax).isBefore(dayjs(completedMin)))
    return err(new InvalidInputError(`completedMax "${args.completedMax ?? ''}" is before completedMin "${args.completedMin ?? ''}". Pass a completedMax on or after completedMin.`));
  return ok({ kind: 'between', completedMin, completedMax });
};

// completedMin / completedMax only match completed tasks, so they contradict completed: 'exclude'.
const requireCompletedTasks = (args: ListTasksArgs, filter: CompletedAtFilter): Result<CompletedAtFilter, InvalidInputError> => {
  if (filter.kind === 'any' || args.completed !== 'exclude') return ok(filter);
  return err(new InvalidInputError("completedMin / completedMax only match completed tasks, but completed is 'exclude'. Pass completed 'include' (the default) or 'includeHidden', or drop them."));
};

const toCompletedAtFilter = (args: ListTasksArgs): Result<CompletedAtFilter, InvalidInputError> =>
  parseOptionalBound('completedMin', args.completedMin).andThen((min) =>
    parseOptionalBound('completedMax', args.completedMax)
      .andThen((max) => toCompletedRange(args, min, max))
      .andThen((filter) => requireCompletedTasks(args, filter)),
  );

const toScope = (args: ListTasksArgs, options: ListTasksOptions): Result<ListTasksQuery, InvalidInputError> => {
  if (args.list !== undefined) return ok({ kind: 'one', list: toListTarget(args.list), page: toPageRequest(args.pageToken), options });
  if (args.pageToken === undefined) return ok({ kind: 'all', options });
  return err(
    new InvalidInputError(
      `pageToken "${args.pageToken}" needs list: a page token continues one task list. Pass the taskListId of the list it came from as list, or drop pageToken to list every list.`,
    ),
  );
};

const toDueArgs = (args: ListTasksArgs): Result<TaskDueFilter, InvalidInputError> =>
  parseOptionalDate('dueFrom', args.dueFrom).andThen((dueMin) => parseOptionalDate('dueTo', args.dueTo).andThen((dueMax) => toDueFilter(dueMin, dueMax)));

export const toListTasksQuery = (args: ListTasksArgs): Result<ListTasksQuery, InvalidInputError> =>
  Result.combine([toDueArgs(args), toCompletedAtFilter(args), toUpdatedFilter(args)]).andThen(([due, completedAt, updated]) =>
    toScope(args, {
      due,
      completed: args.completed ?? 'include',
      completedAt,
      updated,
      deleted: args.showDeleted === true ? 'include' : 'exclude',
      assigned: args.showAssigned === true ? 'include' : 'exclude',
      maxResults: args.maxResults ?? DEFAULT_PAGE_SIZE,
    }),
  );

// ---- create ----

// An absent parentId means the top level, an absent previousId means first among the siblings.
const toPlacement = (args: { readonly parentId?: string | undefined; readonly previousId?: string | undefined }): TaskPlacement => {
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

// ---- move ----

// Where move_task takes the task: its own list, or another one still to be resolved.
export type MoveDestinationTarget = { readonly kind: 'sameList' } | { readonly kind: 'otherList'; readonly list: ListTarget };

// A move with its source list and destination still unresolved.
export type MoveTaskRequest = {
  readonly list: ListTarget;
  readonly destination: MoveDestinationTarget;
  readonly input: Omit<MoveTaskInput, 'taskListId' | 'destination'>;
};

// Naming the source list again as the destination is a move within the list.
const toMoveDestination = (args: MoveTaskArgs): MoveDestinationTarget => {
  if (args.destinationList === undefined) return { kind: 'sameList' };
  const [source, destination] = [toListTarget(args.list), toListTarget(args.destinationList)];
  const same = (source.kind === 'default' && destination.kind === 'default') || (source.kind === 'named' && destination.kind === 'named' && source.name === destination.name);
  return same ? { kind: 'sameList' } : { kind: 'otherList', list: destination };
};

const rejectSelf = (arg: string, taskId: string, value: string | undefined): Result<undefined, InvalidInputError> =>
  value === taskId ? err(new InvalidInputError(`${arg} "${value}" is the task being moved. Pass the id of a different task from list_tasks, or omit ${arg}.`)) : ok(undefined);

export const toMoveTaskRequest = (args: MoveTaskArgs): Result<MoveTaskRequest, InvalidInputError> =>
  Result.combine([rejectSelf('parentId', args.taskId, args.parentId), rejectSelf('previousId', args.taskId, args.previousId)]).map(() => ({
    list: toListTarget(args.list),
    destination: toMoveDestination(args),
    input: { taskId: args.taskId, placement: toPlacement(args) },
  }));

// ---- task lists ----

// Titles and the undeletable default list are checked with core's validators before any lookup.

export const toCreateTaskListInput = (args: CreateTaskListArgs): Result<CreateTaskListInput, InvalidInputError> => validateTaskListTitle(args.title).map((title) => ({ title }));

export const toRenameTaskListInput = (args: RenameTaskListArgs): Result<Targeted<RenameTaskListInput>, InvalidInputError> =>
  validateTaskListTitle(args.title).map((title) => ({ list: toListTarget(args.list), input: { title } }));

export const toGetTaskListTarget = (args: GetTaskListArgs): ListTarget => toListTarget(args.list);

// The list whose completed tasks to clear (never blank), still to be resolved. `confirm` is checked by the schema.
export const toClearTaskListTarget = (args: ClearCompletedTasksArgs): Result<ListTarget, InvalidInputError> => validateClearableTaskListId(args.list).map(toListTarget);

// The title or id of the list to delete, still to be resolved.
export const toDeleteTaskListName = (args: DeleteTaskListArgs): Result<string, InvalidInputError> => validateDeletableTaskListId(args.list);
