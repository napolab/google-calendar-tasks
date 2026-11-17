import { err, ok, okAsync } from 'neverthrow';
import { z } from 'zod';

import { dayjs } from '../dayjs';
import { AmbiguousTaskListError, InvalidInputError, TaskListNotFoundError } from '../errors';

import type { GoogleError } from '../errors';
import type { GoogleClient, QueryValue } from '../google-client';
import type { Result, ResultAsync } from 'neverthrow';

const BASE_URL = 'https://tasks.googleapis.com/tasks/v1';

// Google's alias for the user's default task list; valid wherever a task list id is.
export const DEFAULT_TASK_LIST_ID = '@default';

// ---------------------------------------------------------------------------------------------
// Output (read side: normalized, every state is a named variant — no optional fields)
// ---------------------------------------------------------------------------------------------

export type TaskListSummary = {
  readonly id: string;
  readonly title: string;
  readonly updated: string;
};

// Google Tasks `due` is date-only. `date` is `YYYY-MM-DD`.
export type TaskDue = { readonly kind: 'none' } | { readonly kind: 'date'; readonly date: string };

export type TaskHierarchy = { readonly kind: 'root' } | { readonly kind: 'subtask'; readonly parentId: string };

type TaskFields = {
  readonly id: string;
  // Echoes the list id the caller addressed — `'@default'` when it was defaulted.
  readonly taskListId: string;
  readonly title: string;
  // `''` when the task has no notes.
  readonly notes: string;
  readonly due: TaskDue;
  readonly hierarchy: TaskHierarchy;
  // Sort key among siblings; compare lexicographically.
  readonly position: string;
  // RFC 3339.
  readonly updated: string;
  readonly webViewLink: string;
};

export type OpenTask = TaskFields & { readonly status: 'needsAction' };

export type CompletedTask = TaskFields & {
  readonly status: 'completed';
  // RFC 3339.
  readonly completedAt: string;
};

export type Task = OpenTask | CompletedTask;

export type TaskPageCursor = { readonly kind: 'last' } | { readonly kind: 'more'; readonly pageToken: string };

export type TaskPage = {
  readonly items: readonly Task[];
  readonly next: TaskPageCursor;
};

// ---------------------------------------------------------------------------------------------
// Input (write side: strict, every choice is an explicit variant)
// ---------------------------------------------------------------------------------------------

// `taskListId` is the single optional left in the inputs: it is the outermost defaulted
// argument (→ '@default', like calendarId → 'primary'). A `{ kind: 'default' } | { kind: 'id' }`
// variant would add noise to every call without naming any extra state
// (.claude/rules/discriminated-unions.md "Allowed optionals").
type TaskListTarget = {
  readonly taskListId?: string;
};

export type TaskRef = TaskListTarget & {
  readonly taskId: string;
};

// Due filter for listing. Dates are `YYYY-MM-DD`; both bounds are inclusive days.
export type TaskDueFilter =
  | { readonly kind: 'any' }
  | { readonly kind: 'from'; readonly dueMin: string }
  | { readonly kind: 'until'; readonly dueMax: string }
  | { readonly kind: 'between'; readonly dueMin: string; readonly dueMax: string };

// Which completed tasks to return. Tasks completed in Google's own apps are "hidden", so
// `include` alone misses them — use `includeHidden` to see every completed task.
export type CompletedTasksFilter = 'exclude' | 'include' | 'includeHidden';

export type TaskPageRequest = { readonly kind: 'first' } | { readonly kind: 'token'; readonly pageToken: string };

export type ListTasksInput = TaskListTarget & {
  readonly due: TaskDueFilter;
  readonly completed: CompletedTasksFilter;
  readonly page: TaskPageRequest;
  // 1..100.
  readonly maxResults: number;
};

export type TaskSiblingPosition = { readonly kind: 'first' } | { readonly kind: 'after'; readonly previousId: string };

export type TaskPlacement = { readonly kind: 'root'; readonly position: TaskSiblingPosition } | { readonly kind: 'subtask'; readonly parentId: string; readonly position: TaskSiblingPosition };

export type CreateTaskInput = TaskListTarget & {
  readonly title: string;
  // `''` creates the task without notes.
  readonly notes: string;
  readonly due: TaskDue;
  readonly placement: TaskPlacement;
};

export type KeepOrSet<T> = { readonly kind: 'keep' } | { readonly kind: 'set'; readonly value: T };

export type FieldPatch<T> = KeepOrSet<T> | { readonly kind: 'clear' };

// Task-list operations always name their list: a create / rename / delete must never fall back to a default.
// `taskListId` may be `'@default'` for get and rename; deleteTaskList rejects it (Google cannot delete the default list).
export type TaskListRef = {
  readonly taskListId: string;
};

export type CreateTaskListInput = {
  // Non-blank, at most 1024 characters (Google's limit).
  readonly title: string;
};

export type RenameTaskListInput = TaskListRef & {
  // Non-blank, at most 1024 characters (Google's limit).
  readonly title: string;
};

export type UpdateTaskInput = TaskRef & {
  // A task always has a title, so it can be replaced but not cleared.
  readonly title: KeepOrSet<string>;
  readonly notes: FieldPatch<string>;
  // `value` is `YYYY-MM-DD`.
  readonly due: FieldPatch<string>;
};

export interface ITasksService {
  listTaskLists(): ResultAsync<readonly TaskListSummary[], GoogleError>;
  getTaskList(input: TaskListRef): ResultAsync<TaskListSummary, GoogleError>;
  createTaskList(input: CreateTaskListInput): ResultAsync<TaskListSummary, GoogleError | InvalidInputError>;
  renameTaskList(input: RenameTaskListInput): ResultAsync<TaskListSummary, GoogleError | InvalidInputError>;
  deleteTaskList(input: TaskListRef): ResultAsync<void, GoogleError | InvalidInputError>;
  listTasks(input: ListTasksInput): ResultAsync<TaskPage, GoogleError | InvalidInputError>;
  getTask(input: TaskRef): ResultAsync<Task, GoogleError>;
  createTask(input: CreateTaskInput): ResultAsync<Task, GoogleError | InvalidInputError>;
  updateTask(input: UpdateTaskInput): ResultAsync<Task, GoogleError | InvalidInputError>;
  completeTask(input: TaskRef): ResultAsync<Task, GoogleError>;
  reopenTask(input: TaskRef): ResultAsync<Task, GoogleError>;
  deleteTask(input: TaskRef): ResultAsync<void, GoogleError>;
}

export type TasksServiceDeps = {
  readonly client: GoogleClient;
};

// ---------------------------------------------------------------------------------------------
// Wire shapes (Google JSON). Google may send `null` or omit a field; `optionalString` accepts
// both and coerces them to `undefined` here, at the boundary (.claude/rules/function-arg-types.md).
// ---------------------------------------------------------------------------------------------

const optionalString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

const listOf = <S extends z.ZodType>(item: S) =>
  z
    .array(item)
    .nullish()
    .transform((items) => items ?? []);

const wireTaskListSchema = z.object({
  id: z.string(),
  title: optionalString,
  updated: z.string(),
});

const wireTaskListsSchema = z.object({
  items: listOf(wireTaskListSchema),
  nextPageToken: optionalString,
});

const wireTaskFields = {
  id: z.string(),
  title: optionalString,
  notes: optionalString,
  due: optionalString,
  parent: optionalString,
  position: z.string(),
  updated: z.string(),
  webViewLink: z.string(),
};

// `completed` is required exactly when the task is completed; a stray value on an open task is dropped.
const wireTaskSchema = z.discriminatedUnion('status', [
  z.object({ ...wireTaskFields, status: z.literal('needsAction') }),
  z.object({ ...wireTaskFields, status: z.literal('completed'), completed: z.string() }),
]);

const wireTasksSchema = z.object({
  items: listOf(wireTaskSchema),
  nextPageToken: optionalString,
});

type WireTaskList = z.output<typeof wireTaskListSchema>;
type WireTask = z.output<typeof wireTaskSchema>;
type WireTasks = z.output<typeof wireTasksSchema>;

// ---------------------------------------------------------------------------------------------
// Wire → domain
// ---------------------------------------------------------------------------------------------

// Google stores `due` at midnight UTC, so its UTC date is the day.
const toTaskDue = (due: string | undefined): TaskDue => (due === undefined ? { kind: 'none' } : { kind: 'date', date: dayjs.utc(due).format('YYYY-MM-DD') });

const toHierarchy = (parent: string | undefined): TaskHierarchy => (parent === undefined ? { kind: 'root' } : { kind: 'subtask', parentId: parent });

const toSummary = (wire: WireTaskList): TaskListSummary => ({ id: wire.id, title: wire.title ?? '', updated: wire.updated });

const toTaskFields = (taskListId: string, wire: WireTask): TaskFields => ({
  id: wire.id,
  taskListId,
  title: wire.title ?? '',
  notes: wire.notes ?? '',
  due: toTaskDue(wire.due),
  hierarchy: toHierarchy(wire.parent),
  position: wire.position,
  updated: wire.updated,
  webViewLink: wire.webViewLink,
});

const toTask =
  (taskListId: string) =>
  (wire: WireTask): Task => {
    switch (wire.status) {
      case 'needsAction':
        return { ...toTaskFields(taskListId, wire), status: 'needsAction' };
      case 'completed':
        return { ...toTaskFields(taskListId, wire), status: 'completed', completedAt: wire.completed };
      default: {
        const _exhaustive: never = wire;
        throw new Error(`unhandled task status: ${JSON.stringify(_exhaustive)}`);
      }
    }
  };

const toCursor = (nextPageToken: string | undefined): TaskPageCursor => (nextPageToken === undefined ? { kind: 'last' } : { kind: 'more', pageToken: nextPageToken });

const toTaskPage =
  (taskListId: string) =>
  (page: WireTasks): TaskPage => ({
    items: page.items.map(toTask(taskListId)),
    next: toCursor(page.nextPageToken),
  });

// ---------------------------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------------------------

const TASK_LISTS_URL = `${BASE_URL}/users/@me/lists`;

const taskListURL = (taskListId: string): string => `${TASK_LISTS_URL}/${encodeURIComponent(taskListId)}`;

const resolveTaskListId = (target: TaskListTarget): string => target.taskListId ?? DEFAULT_TASK_LIST_ID;

const tasksURL = (taskListId: string): string => `${BASE_URL}/lists/${encodeURIComponent(taskListId)}/tasks`;

const taskURL = (taskListId: string, taskId: string): string => `${tasksURL(taskListId)}/${encodeURIComponent(taskId)}`;

// ---------------------------------------------------------------------------------------------
// Input validation (.claude/rules/mcp-write-strict.md)
// ---------------------------------------------------------------------------------------------

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A rolled-over date such as 2026-02-30 does not round-trip through UTC formatting.
const isDateOnly = (value: string): boolean => DATE_ONLY_PATTERN.test(value) && dayjs.utc(value).format('YYYY-MM-DD') === value;

const validateDateOnly =
  (field: string) =>
  (value: string): Result<string, InvalidInputError> => {
    if (isDateOnly(value)) return ok(value);
    return err(
      new InvalidInputError(
        `Invalid ${field} "${value}": expected a calendar date in YYYY-MM-DD format (e.g. 2026-11-20). Google Tasks dates are date-only, so pass the day without a time or offset.`,
      ),
    );
  };

const validateTitle = (title: string): Result<string, InvalidInputError> => {
  if (title.trim() !== '') return ok(title);
  return err(new InvalidInputError(`Invalid title "${title}": a task title must not be empty. Pass a non-empty title.`));
};

const validateTaskDue = (due: TaskDue): Result<TaskDue, InvalidInputError> => {
  switch (due.kind) {
    case 'none':
      return ok(due);
    case 'date':
      return validateDateOnly('due')(due.date).map((date) => ({ kind: 'date', date }));
    default: {
      const _exhaustive: never = due;
      throw new Error(`unhandled due: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateKeepOrSet =
  <T>(validate: (value: T) => Result<T, InvalidInputError>) =>
  (patch: KeepOrSet<T>): Result<KeepOrSet<T>, InvalidInputError> => {
    switch (patch.kind) {
      case 'keep':
        return ok(patch);
      case 'set':
        return validate(patch.value).map((value) => ({ kind: 'set', value }));
      default: {
        const _exhaustive: never = patch;
        throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
      }
    }
  };

const validateFieldPatch =
  <T>(validate: (value: T) => Result<T, InvalidInputError>) =>
  (patch: FieldPatch<T>): Result<FieldPatch<T>, InvalidInputError> => {
    switch (patch.kind) {
      case 'keep':
      case 'set':
        return validateKeepOrSet(validate)(patch);
      case 'clear':
        return ok(patch);
      default: {
        const _exhaustive: never = patch;
        throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
      }
    }
  };

// Google discards the time part of `due`, so send the day at midnight UTC.
const toGoogleDue = (date: string): string => dayjs.utc(date).toISOString();

// The end of the UTC day keeps tasks due that day whether Google treats dueMax as inclusive or exclusive.
const toGoogleDueMax = (date: string): string => dayjs.utc(date).endOf('day').toISOString();

// ---------------------------------------------------------------------------------------------
// listTaskLists
// ---------------------------------------------------------------------------------------------

const fetchTaskListPages = (client: GoogleClient, pageToken: string | undefined, acc: readonly TaskListSummary[]): ResultAsync<readonly TaskListSummary[], GoogleError> =>
  client.request({ method: 'GET', url: TASK_LISTS_URL, query: { pageToken }, schema: wireTaskListsSchema }).andThen((page) => {
    const collected = [...acc, ...page.items.map(toSummary)];
    if (page.nextPageToken === undefined) return okAsync(collected);
    return fetchTaskListPages(client, page.nextPageToken, collected);
  });

// ---------------------------------------------------------------------------------------------
// getTaskList / createTaskList / renameTaskList / deleteTaskList (tasklists.get / insert / patch / delete)
// ---------------------------------------------------------------------------------------------

// Google's limit on a task list title.
const MAX_TASK_LIST_TITLE_LENGTH = 1024;

// Shared with the CLI and the MCP server so they can reject a bad title before resolving the list.
export const validateTaskListTitle = (title: string): Result<string, InvalidInputError> => {
  if (title.trim() === '') return err(new InvalidInputError(`Invalid title "${title}": a task list title must not be empty or only whitespace. Pass a non-empty title.`));
  if (title.length <= MAX_TASK_LIST_TITLE_LENGTH) return ok(title);
  return err(new InvalidInputError(`Invalid title: a task list title is at most ${MAX_TASK_LIST_TITLE_LENGTH} characters, got ${title.length}. Pass a shorter title.`));
};

// Google cannot delete the user's default task list (tasklists.delete), so the alias is rejected before any request.
// A blank value is rejected too: as a title it would match an untitled list, and a destructive call must name its list.
// Shared with the CLI and the MCP server so they can reject both before looking the list up.
// The default list addressed by its real id is only caught by Google.
export const validateDeletableTaskListId = (taskListId: string): Result<string, InvalidInputError> => {
  if (taskListId.trim() === '') return err(new InvalidInputError(`Invalid task list "${taskListId}": name the list to delete by its id or title (it must not be empty or only whitespace).`));
  if (taskListId !== DEFAULT_TASK_LIST_ID) return ok(taskListId);
  return err(
    new InvalidInputError(
      `Cannot delete "${DEFAULT_TASK_LIST_ID}": the default task list cannot be deleted (Google does not allow it). Pass the id of another task list instead, or rename the default list if you only want a different title.`,
    ),
  );
};

const getTaskList =
  (client: GoogleClient) =>
  (input: TaskListRef): ResultAsync<TaskListSummary, GoogleError> =>
    client.request({ method: 'GET', url: taskListURL(input.taskListId), schema: wireTaskListSchema }).map(toSummary);

const createTaskList =
  (client: GoogleClient) =>
  (input: CreateTaskListInput): ResultAsync<TaskListSummary, GoogleError | InvalidInputError> =>
    validateTaskListTitle(input.title).asyncAndThen((title) => client.request({ method: 'POST', url: TASK_LISTS_URL, body: { title }, schema: wireTaskListSchema }).map(toSummary));

const renameTaskList =
  (client: GoogleClient) =>
  (input: RenameTaskListInput): ResultAsync<TaskListSummary, GoogleError | InvalidInputError> =>
    validateTaskListTitle(input.title).asyncAndThen((title) => client.request({ method: 'PATCH', url: taskListURL(input.taskListId), body: { title }, schema: wireTaskListSchema }).map(toSummary));

const deleteTaskList =
  (client: GoogleClient) =>
  (input: TaskListRef): ResultAsync<void, GoogleError | InvalidInputError> =>
    validateDeletableTaskListId(input.taskListId).asyncAndThen((taskListId) => client.request({ method: 'DELETE', url: taskListURL(taskListId), schema: z.undefined() }));

// ---------------------------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------------------------

const MAX_RESULTS_LIMIT = 100;

const isWholeNumber = (value: number): boolean => Math.trunc(value) === value;

const validateMaxResults = (maxResults: number): Result<number, InvalidInputError> => {
  if (isWholeNumber(maxResults) && maxResults >= 1 && maxResults <= MAX_RESULTS_LIMIT) return ok(maxResults);
  return err(
    new InvalidInputError(
      `Invalid maxResults ${maxResults}: expected an integer between 1 and ${MAX_RESULTS_LIMIT}. Lower it and follow next.pageToken with page { kind: 'token', pageToken } for more tasks.`,
    ),
  );
};

const validateDueOrder = (dueMin: string, dueMax: string): Result<TaskDueFilter, InvalidInputError> => {
  if (!dayjs.utc(dueMin).isAfter(dayjs.utc(dueMax))) return ok({ kind: 'between', dueMin, dueMax });
  return err(new InvalidInputError(`Invalid due range: dueMin "${dueMin}" is after dueMax "${dueMax}". Pass dueMin on or before dueMax (both YYYY-MM-DD), or swap them.`));
};

const validateDueFilter = (filter: TaskDueFilter): Result<TaskDueFilter, InvalidInputError> => {
  switch (filter.kind) {
    case 'any':
      return ok(filter);
    case 'from':
      return validateDateOnly('dueMin')(filter.dueMin).map((dueMin) => ({ kind: 'from', dueMin }));
    case 'until':
      return validateDateOnly('dueMax')(filter.dueMax).map((dueMax) => ({ kind: 'until', dueMax }));
    case 'between':
      return validateDateOnly('dueMin')(filter.dueMin).andThen((dueMin) => validateDateOnly('dueMax')(filter.dueMax).andThen((dueMax) => validateDueOrder(dueMin, dueMax)));
    default: {
      const _exhaustive: never = filter;
      throw new Error(`unhandled due filter: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type Query = Readonly<Record<string, QueryValue>>;

const dueQuery = (filter: TaskDueFilter): Query => {
  switch (filter.kind) {
    case 'any':
      return {};
    case 'from':
      return { dueMin: toGoogleDue(filter.dueMin) };
    case 'until':
      return { dueMax: toGoogleDueMax(filter.dueMax) };
    case 'between':
      return { dueMin: toGoogleDue(filter.dueMin), dueMax: toGoogleDueMax(filter.dueMax) };
    default: {
      const _exhaustive: never = filter;
      throw new Error(`unhandled due filter: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const COMPLETED_QUERY = {
  exclude: { showCompleted: false, showHidden: false },
  include: { showCompleted: true, showHidden: false },
  includeHidden: { showCompleted: true, showHidden: true },
} satisfies Record<CompletedTasksFilter, Query>;

const pageQuery = (page: TaskPageRequest): Query => {
  switch (page.kind) {
    case 'first':
      return {};
    case 'token':
      return { pageToken: page.pageToken };
    default: {
      const _exhaustive: never = page;
      throw new Error(`unhandled page request: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateListTasks = (input: ListTasksInput): Result<Query, InvalidInputError> =>
  validateDueFilter(input.due).andThen((due) =>
    validateMaxResults(input.maxResults).map((maxResults) => ({ ...dueQuery(due), ...COMPLETED_QUERY[input.completed], ...pageQuery(input.page), maxResults })),
  );

const listTasks =
  (client: GoogleClient) =>
  (input: ListTasksInput): ResultAsync<TaskPage, GoogleError | InvalidInputError> => {
    const taskListId = resolveTaskListId(input);
    return validateListTasks(input).asyncAndThen((query) => client.request({ method: 'GET', url: tasksURL(taskListId), query, schema: wireTasksSchema }).map(toTaskPage(taskListId)));
  };

// ---------------------------------------------------------------------------------------------
// getTask / deleteTask
// ---------------------------------------------------------------------------------------------

const getTask =
  (client: GoogleClient) =>
  (input: TaskRef): ResultAsync<Task, GoogleError> => {
    const taskListId = resolveTaskListId(input);
    return client.request({ method: 'GET', url: taskURL(taskListId, input.taskId), schema: wireTaskSchema }).map(toTask(taskListId));
  };

const deleteTask =
  (client: GoogleClient) =>
  (input: TaskRef): ResultAsync<void, GoogleError> =>
    client.request({ method: 'DELETE', url: taskURL(resolveTaskListId(input), input.taskId), schema: z.undefined() });

// ---------------------------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------------------------

// Wire body for tasks.insert: an absent key is simply not set on the new task.
type WireTaskInsert = {
  readonly title: string;
  readonly notes?: string;
  readonly due?: string;
};

const insertNotes = (notes: string): Pick<WireTaskInsert, 'notes'> => (notes === '' ? {} : { notes });

const insertDue = (due: TaskDue): Pick<WireTaskInsert, 'due'> => {
  switch (due.kind) {
    case 'none':
      return {};
    case 'date':
      return { due: toGoogleDue(due.date) };
    default: {
      const _exhaustive: never = due;
      throw new Error(`unhandled due: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const siblingQuery = (position: TaskSiblingPosition): Query => {
  switch (position.kind) {
    case 'first':
      return {};
    case 'after':
      return { previous: position.previousId };
    default: {
      const _exhaustive: never = position;
      throw new Error(`unhandled sibling position: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// tasks.insert takes the placement as `parent` / `previous` query parameters, not body fields.
const placementQuery = (placement: TaskPlacement): Query => {
  switch (placement.kind) {
    case 'root':
      return siblingQuery(placement.position);
    case 'subtask':
      return { parent: placement.parentId, ...siblingQuery(placement.position) };
    default: {
      const _exhaustive: never = placement;
      throw new Error(`unhandled placement: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateCreate = (input: CreateTaskInput): Result<WireTaskInsert, InvalidInputError> =>
  validateTitle(input.title).andThen((title) => validateTaskDue(input.due).map((due) => ({ title, ...insertNotes(input.notes), ...insertDue(due) })));

const createTask =
  (client: GoogleClient) =>
  (input: CreateTaskInput): ResultAsync<Task, GoogleError | InvalidInputError> => {
    const taskListId = resolveTaskListId(input);
    return validateCreate(input).asyncAndThen((body) =>
      client.request({ method: 'POST', url: tasksURL(taskListId), query: placementQuery(input.placement), body, schema: wireTaskSchema }).map(toTask(taskListId)),
    );
  };

// ---------------------------------------------------------------------------------------------
// updateTask / completeTask / reopenTask (tasks.patch)
// ---------------------------------------------------------------------------------------------

// Wire body for tasks.patch: absent key = leave unchanged, `null` = clear the field.
type WireTaskPatch = {
  readonly title?: string;
  readonly notes?: string | null;
  readonly status?: 'needsAction' | 'completed';
  readonly due?: string | null;
  readonly completed?: null;
};

const patchTask = (client: GoogleClient, ref: TaskRef, body: WireTaskPatch): ResultAsync<Task, GoogleError> => {
  const taskListId = resolveTaskListId(ref);
  return client.request({ method: 'PATCH', url: taskURL(taskListId, ref.taskId), body, schema: wireTaskSchema }).map(toTask(taskListId));
};

const isKeep = (patch: FieldPatch<string>): boolean => patch.kind === 'keep';

const requireChange = (input: UpdateTaskInput): Result<UpdateTaskInput, InvalidInputError> => {
  if (!isKeep(input.title) || !isKeep(input.notes) || !isKeep(input.due)) return ok(input);
  return err(
    new InvalidInputError(
      `Nothing to update for task "${input.taskId}": title, notes and due are all { kind: 'keep' }. Set at least one of title ({ kind: 'set', value }), notes ({ kind: 'set', value } or { kind: 'clear' }) or due ({ kind: 'set', value: 'YYYY-MM-DD' } or { kind: 'clear' }). Use completeTask / reopenTask to change the status.`,
    ),
  );
};

type ValidatedUpdate = {
  readonly title: KeepOrSet<string>;
  readonly notes: FieldPatch<string>;
  readonly due: FieldPatch<string>;
};

const validateUpdate = (input: UpdateTaskInput): Result<ValidatedUpdate, InvalidInputError> =>
  requireChange(input)
    .andThen(() => validateKeepOrSet(validateTitle)(input.title))
    .andThen((title) => validateFieldPatch(validateDateOnly('due'))(input.due).map((due) => ({ title, notes: input.notes, due })));

const patchTitle = (patch: KeepOrSet<string>): Pick<WireTaskPatch, 'title'> => {
  switch (patch.kind) {
    case 'keep':
      return {};
    case 'set':
      return { title: patch.value };
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const patchNotes = (patch: FieldPatch<string>): Pick<WireTaskPatch, 'notes'> => {
  switch (patch.kind) {
    case 'keep':
      return {};
    case 'set':
      return { notes: patch.value };
    case 'clear':
      return { notes: null };
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const patchDue = (patch: FieldPatch<string>): Pick<WireTaskPatch, 'due'> => {
  switch (patch.kind) {
    case 'keep':
      return {};
    case 'set':
      return { due: toGoogleDue(patch.value) };
    case 'clear':
      return { due: null };
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toPatchBody = (update: ValidatedUpdate): WireTaskPatch => ({ ...patchTitle(update.title), ...patchNotes(update.notes), ...patchDue(update.due) });

const updateTask =
  (client: GoogleClient) =>
  (input: UpdateTaskInput): ResultAsync<Task, GoogleError | InvalidInputError> =>
    validateUpdate(input).asyncAndThen((update) => patchTask(client, input, toPatchBody(update)));

const completeTask =
  (client: GoogleClient) =>
  (input: TaskRef): ResultAsync<Task, GoogleError> =>
    patchTask(client, input, { status: 'completed' });

const reopenTask =
  (client: GoogleClient) =>
  (input: TaskRef): ResultAsync<Task, GoogleError> =>
    patchTask(client, input, { status: 'needsAction', completed: null });

// ---------------------------------------------------------------------------------------------
// resolveTaskList: a task list named by id or title (pure, shared by the CLI and the MCP server)
// ---------------------------------------------------------------------------------------------

type TaskListMatch =
  | { readonly kind: 'id'; readonly list: TaskListSummary }
  | { readonly kind: 'title'; readonly list: TaskListSummary }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly TaskListSummary[] };

// Titles compare after NFKC (full-width ↔ half-width), trimming and case folding.
const normalizeTitle = (title: string): string => title.normalize('NFKC').trim().toLowerCase();

const matchByTitle = (lists: readonly TaskListSummary[], query: string): TaskListMatch => {
  const wanted = normalizeTitle(query);
  const [first, ...rest] = lists.filter((list) => normalizeTitle(list.title) === wanted);
  if (first === undefined) return { kind: 'none' };
  return rest.length === 0 ? { kind: 'title', list: first } : { kind: 'ambiguous', candidates: [first, ...rest] };
};

// An exact id wins over any title.
const matchTaskList = (lists: readonly TaskListSummary[], query: string): TaskListMatch => {
  const byId = lists.find((list) => list.id === query);
  return byId === undefined ? matchByTitle(lists, query) : { kind: 'id', list: byId };
};

// Finds the task list `query` names: an exact id, else a title (NFKC, trimmed, case-insensitive).
// `DEFAULT_TASK_LIST_ID` is not a list in `lists` — callers pass it through as the id without resolving it.
export const resolveTaskList = (lists: readonly TaskListSummary[], query: string): Result<TaskListSummary, TaskListNotFoundError | AmbiguousTaskListError> => {
  const match = matchTaskList(lists, query);
  switch (match.kind) {
    case 'id':
    case 'title':
      return ok(match.list);
    case 'none':
      return err(
        new TaskListNotFoundError(
          query,
          lists.map((list) => list.title),
        ),
      );
    case 'ambiguous':
      return err(new AmbiguousTaskListError(query, match.candidates));
    default: {
      const _exhaustive: never = match;
      throw new Error(`unhandled task list match: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const createTasksService = (deps: TasksServiceDeps): ITasksService => ({
  listTaskLists: () => fetchTaskListPages(deps.client, undefined, []),
  getTaskList: getTaskList(deps.client),
  createTaskList: createTaskList(deps.client),
  renameTaskList: renameTaskList(deps.client),
  deleteTaskList: deleteTaskList(deps.client),
  listTasks: listTasks(deps.client),
  getTask: getTask(deps.client),
  createTask: createTask(deps.client),
  updateTask: updateTask(deps.client),
  completeTask: completeTask(deps.client),
  reopenTask: reopenTask(deps.client),
  deleteTask: deleteTask(deps.client),
});
