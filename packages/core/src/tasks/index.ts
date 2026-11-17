import { Result, err, errAsync, ok, okAsync } from 'neverthrow';
import { z } from 'zod';

import { dayjs } from '../dayjs';
import { AmbiguousTaskListError, GoogleAPIError, GoogleNotFoundError, InvalidInputError, TaskListNotFoundError } from '../errors';

import type { GoogleError } from '../errors';
import type { GoogleClient, QueryValue } from '../google-client';
import type { ResultAsync } from 'neverthrow';

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

// A read-only link Google attaches to a task (e.g. the Gmail message it was created from).
export type TaskLink = {
  // e.g. 'email', 'generic', 'chat_message', 'keep_note'.
  readonly type: string;
  // `''` when Google sends no description.
  readonly description: string;
  readonly link: string;
};

// Where an assigned task comes from (Google's assignmentInfo; read-only).
export type TaskAssignmentSource =
  | { readonly kind: 'document'; readonly driveFileId: string; readonly resourceKey: string }
  | { readonly kind: 'space'; readonly space: string }
  // A surface Google gives no details for; `surfaceType` is Google's enum value (e.g. 'GMAIL').
  | { readonly kind: 'other'; readonly surfaceType: string };

export type TaskAssignment = { readonly kind: 'none' } | { readonly kind: 'assigned'; readonly linkToTask: string; readonly source: TaskAssignmentSource };

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
  // `''` when Google sends none (e.g. some deleted tasks).
  readonly webViewLink: string;
  readonly links: readonly TaskLink[];
  readonly assignment: TaskAssignment;
  // Deleted tasks are only returned with `deleted: 'include'`.
  readonly deleted: boolean;
  // Completed when the list was last cleared (or completed in Google's own apps).
  readonly hidden: boolean;
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

// Completion-time filter. Bounds are RFC 3339 instants with an explicit offset; it needs completed tasks
// (`completed` other than 'exclude').
export type CompletedAtFilter =
  | { readonly kind: 'any' }
  | { readonly kind: 'from'; readonly completedMin: string }
  | { readonly kind: 'until'; readonly completedMax: string }
  | { readonly kind: 'between'; readonly completedMin: string; readonly completedMax: string };

// Last-modification filter. `updatedMin` is an RFC 3339 instant with an explicit offset.
export type TaskUpdatedFilter = { readonly kind: 'any' } | { readonly kind: 'since'; readonly updatedMin: string };

// Deleted tasks are left out unless included (Google's showDeleted).
export type DeletedTasksFilter = 'exclude' | 'include';

// Tasks assigned to the user from Docs / Chat spaces are left out unless included (Google's showAssigned).
export type AssignedTasksFilter = 'exclude' | 'include';

export type TaskPageRequest = { readonly kind: 'first' } | { readonly kind: 'token'; readonly pageToken: string };

export type ListTasksInput = TaskListTarget & {
  readonly due: TaskDueFilter;
  readonly completed: CompletedTasksFilter;
  readonly completedAt: CompletedAtFilter;
  readonly updated: TaskUpdatedFilter;
  readonly deleted: DeletedTasksFilter;
  readonly assigned: AssignedTasksFilter;
  readonly page: TaskPageRequest;
  // 1..100.
  readonly maxResults: number;
};

export type TaskSiblingPosition = { readonly kind: 'first' } | { readonly kind: 'after'; readonly previousId: string };

export type TaskPlacement = { readonly kind: 'root'; readonly position: TaskSiblingPosition } | { readonly kind: 'subtask'; readonly parentId: string; readonly position: TaskSiblingPosition };

// Where tasks.move takes a task: it stays in its list, or goes to another list (`taskListId` may be '@default').
export type TaskMoveDestination = { readonly kind: 'sameList' } | { readonly kind: 'otherList'; readonly taskListId: string };

// tasks.move always sets the placement: a `root` placement un-nests a subtask, `first` puts it before its siblings.
export type MoveTaskInput = TaskRef & {
  readonly destination: TaskMoveDestination;
  // Parent / previous sibling in the destination list.
  readonly placement: TaskPlacement;
};

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
  moveTask(input: MoveTaskInput): ResultAsync<Task, GoogleError | InvalidInputError>;
  // Hides every completed task of the list (tasks.clear).
  clearCompletedTasks(input: TaskListRef): ResultAsync<void, GoogleError | InvalidInputError>;
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

const optionalFlag = z
  .boolean()
  .nullish()
  .transform((value) => value ?? false);

const wireLinkSchema = z.object({ type: optionalString, description: optionalString, link: optionalString });

const wireAssignmentInfoSchema = z.object({
  linkToTask: optionalString,
  surfaceType: optionalString,
  driveResourceInfo: z.object({ driveFileId: optionalString, resourceKey: optionalString }).nullish(),
  spaceInfo: z.object({ space: optionalString }).nullish(),
});

// Read-only extras (links, assignmentInfo, deleted, hidden) are parsed leniently: one odd task must not fail a page.
const wireTaskFields = {
  id: z.string(),
  title: optionalString,
  notes: optionalString,
  due: optionalString,
  parent: optionalString,
  position: optionalString,
  updated: z.string(),
  webViewLink: optionalString,
  links: listOf(wireLinkSchema),
  assignmentInfo: wireAssignmentInfoSchema.nullish(),
  deleted: optionalFlag,
  hidden: optionalFlag,
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
type WireLink = z.output<typeof wireLinkSchema>;
type WireAssignmentInfo = z.output<typeof wireAssignmentInfoSchema>;

// ---------------------------------------------------------------------------------------------
// Wire → domain
// ---------------------------------------------------------------------------------------------

// Google stores `due` at midnight UTC, so its UTC date is the day.
const toTaskDue = (due: string | undefined): TaskDue => (due === undefined ? { kind: 'none' } : { kind: 'date', date: dayjs.utc(due).format('YYYY-MM-DD') });

const toHierarchy = (parent: string | undefined): TaskHierarchy => (parent === undefined ? { kind: 'root' } : { kind: 'subtask', parentId: parent });

const toSummary = (wire: WireTaskList): TaskListSummary => ({ id: wire.id, title: wire.title ?? '', updated: wire.updated });

const toLink = (wire: WireLink): TaskLink => ({ type: wire.type ?? '', description: wire.description ?? '', link: wire.link ?? '' });

// Google sets at most one of driveResourceInfo / spaceInfo.
const toAssignmentSource = (wire: WireAssignmentInfo): TaskAssignmentSource => {
  const drive = wire.driveResourceInfo ?? undefined;
  if (drive !== undefined && drive.driveFileId !== undefined) return { kind: 'document', driveFileId: drive.driveFileId, resourceKey: drive.resourceKey ?? '' };
  const space = wire.spaceInfo?.space;
  if (space !== undefined) return { kind: 'space', space };
  return { kind: 'other', surfaceType: wire.surfaceType ?? 'CONTEXT_TYPE_UNSPECIFIED' };
};

const toAssignment = (wire: WireAssignmentInfo | null | undefined): TaskAssignment =>
  wire === null || wire === undefined ? { kind: 'none' } : { kind: 'assigned', linkToTask: wire.linkToTask ?? '', source: toAssignmentSource(wire) };

const toTaskFields = (taskListId: string, wire: WireTask): TaskFields => ({
  id: wire.id,
  taskListId,
  title: wire.title ?? '',
  notes: wire.notes ?? '',
  due: toTaskDue(wire.due),
  hierarchy: toHierarchy(wire.parent),
  position: wire.position ?? '',
  updated: wire.updated,
  webViewLink: wire.webViewLink ?? '',
  links: wire.links.map(toLink),
  assignment: toAssignment(wire.assignmentInfo),
  deleted: wire.deleted,
  hidden: wire.hidden,
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

const moveURL = (taskListId: string, taskId: string): string => `${taskURL(taskListId, taskId)}/move`;

const clearURL = (taskListId: string): string => `${BASE_URL}/lists/${encodeURIComponent(taskListId)}/clear`;

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

// z.iso.datetime rejects impossible dates (2026-02-30) that dayjs would roll over.
const instantSchema = z.iso.datetime({ offset: true });

const validateInstant =
  (field: string) =>
  (value: string): Result<string, InvalidInputError> => {
    if (instantSchema.safeParse(value).success) return ok(value);
    return err(
      new InvalidInputError(`Invalid ${field} "${value}": expected an RFC 3339 timestamp with an explicit offset (e.g. 2026-11-17T00:00:00+09:00 or 2026-11-16T15:00:00Z). Add the offset and retry.`),
    );
  };

const validateCompletedOrder = (completedMin: string, completedMax: string): Result<CompletedAtFilter, InvalidInputError> => {
  if (!dayjs.utc(completedMin).isAfter(dayjs.utc(completedMax))) return ok({ kind: 'between', completedMin, completedMax });
  return err(new InvalidInputError(`Invalid completed range: completedMin "${completedMin}" is after completedMax "${completedMax}". Pass completedMin on or before completedMax, or swap them.`));
};

const validateCompletedAtFilter = (filter: CompletedAtFilter): Result<CompletedAtFilter, InvalidInputError> => {
  switch (filter.kind) {
    case 'any':
      return ok(filter);
    case 'from':
      return validateInstant('completedMin')(filter.completedMin).map((completedMin) => ({ kind: 'from', completedMin }));
    case 'until':
      return validateInstant('completedMax')(filter.completedMax).map((completedMax) => ({ kind: 'until', completedMax }));
    case 'between':
      return validateInstant('completedMin')(filter.completedMin).andThen((completedMin) =>
        validateInstant('completedMax')(filter.completedMax).andThen((completedMax) => validateCompletedOrder(completedMin, completedMax)),
      );
    default: {
      const _exhaustive: never = filter;
      throw new Error(`unhandled completed filter: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// A completion-time filter can only match completed tasks, so it contradicts completed: 'exclude'.
const requireCompletedTasks = (input: ListTasksInput): Result<ListTasksInput, InvalidInputError> => {
  if (input.completedAt.kind === 'any' || input.completed !== 'exclude') return ok(input);
  return err(
    new InvalidInputError(
      `A completedAt filter (completedMin / completedMax) only matches completed tasks, but completed is 'exclude'. Pass completed 'include' or 'includeHidden', or drop the completedAt filter.`,
    ),
  );
};

const validateUpdatedFilter = (filter: TaskUpdatedFilter): Result<TaskUpdatedFilter, InvalidInputError> => {
  switch (filter.kind) {
    case 'any':
      return ok(filter);
    case 'since':
      return validateInstant('updatedMin')(filter.updatedMin).map((updatedMin) => ({ kind: 'since', updatedMin }));
    default: {
      const _exhaustive: never = filter;
      throw new Error(`unhandled updated filter: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const completedAtQuery = (filter: CompletedAtFilter): Query => {
  switch (filter.kind) {
    case 'any':
      return {};
    case 'from':
      return { completedMin: filter.completedMin };
    case 'until':
      return { completedMax: filter.completedMax };
    case 'between':
      return { completedMin: filter.completedMin, completedMax: filter.completedMax };
    default: {
      const _exhaustive: never = filter;
      throw new Error(`unhandled completed filter: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const updatedQuery = (filter: TaskUpdatedFilter): Query => {
  switch (filter.kind) {
    case 'any':
      return {};
    case 'since':
      return { updatedMin: filter.updatedMin };
    default: {
      const _exhaustive: never = filter;
      throw new Error(`unhandled updated filter: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const DELETED_QUERY = { exclude: { showDeleted: false }, include: { showDeleted: true } } satisfies Record<DeletedTasksFilter, Query>;

const ASSIGNED_QUERY = { exclude: { showAssigned: false }, include: { showAssigned: true } } satisfies Record<AssignedTasksFilter, Query>;

type ValidatedListFilters = {
  readonly due: TaskDueFilter;
  readonly completedAt: CompletedAtFilter;
  readonly updated: TaskUpdatedFilter;
  readonly maxResults: number;
};

const validateListFilters = (input: ListTasksInput): Result<ValidatedListFilters, InvalidInputError> =>
  Result.combine([validateDueFilter(input.due), validateCompletedAtFilter(input.completedAt), validateUpdatedFilter(input.updated), validateMaxResults(input.maxResults)]).map(
    ([due, completedAt, updated, maxResults]) => ({ due, completedAt, updated, maxResults }),
  );

const toListQuery = (input: ListTasksInput, filters: ValidatedListFilters): Query => ({
  ...dueQuery(filters.due),
  ...COMPLETED_QUERY[input.completed],
  ...completedAtQuery(filters.completedAt),
  ...updatedQuery(filters.updated),
  ...DELETED_QUERY[input.deleted],
  ...ASSIGNED_QUERY[input.assigned],
  ...pageQuery(input.page),
  maxResults: filters.maxResults,
});

const validateListTasks = (input: ListTasksInput): Result<Query, InvalidInputError> =>
  validateListFilters(input)
    .andThen((filters) => requireCompletedTasks(input).map(() => filters))
    .map((filters) => toListQuery(input, filters));

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
// moveTask (tasks.move) / clearCompletedTasks (tasks.clear)
// ---------------------------------------------------------------------------------------------

const rejectSelfReference = (field: string, taskId: string, value: string): Result<string, InvalidInputError> => {
  if (value !== taskId) return ok(value);
  return err(new InvalidInputError(`Invalid ${field} "${value}": it is the task being moved. Pass the id of a different task (from listTasks), or omit it.`));
};

const validateSibling = (taskId: string, position: TaskSiblingPosition): Result<TaskSiblingPosition, InvalidInputError> => {
  switch (position.kind) {
    case 'first':
      return ok(position);
    case 'after':
      return rejectSelfReference('previousId', taskId, position.previousId).map((previousId) => ({ kind: 'after', previousId }));
    default: {
      const _exhaustive: never = position;
      throw new Error(`unhandled sibling position: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateMovePlacement = (taskId: string, placement: TaskPlacement): Result<TaskPlacement, InvalidInputError> => {
  switch (placement.kind) {
    case 'root':
      return validateSibling(taskId, placement.position).map((position) => ({ kind: 'root', position }));
    case 'subtask':
      return rejectSelfReference('parentId', taskId, placement.parentId).andThen((parentId) =>
        validateSibling(taskId, placement.position).map((position): TaskPlacement => ({ kind: 'subtask', parentId, position })),
      );
    default: {
      const _exhaustive: never = placement;
      throw new Error(`unhandled placement: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateDestination = (destination: TaskMoveDestination): Result<TaskMoveDestination, InvalidInputError> => {
  switch (destination.kind) {
    case 'sameList':
      return ok(destination);
    case 'otherList':
      if (destination.taskListId.trim() !== '') return ok(destination);
      return err(
        new InvalidInputError(
          `Invalid destination task list "${destination.taskListId}": it must not be empty or only whitespace. Pass a task list id (or '@default'), or keep the task in its list with { kind: 'sameList' }.`,
        ),
      );
    default: {
      const _exhaustive: never = destination;
      throw new Error(`unhandled destination: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const destinationQuery = (destination: TaskMoveDestination): Query => {
  switch (destination.kind) {
    case 'sameList':
      return {};
    case 'otherList':
      return { destinationTasklist: destination.taskListId };
    default: {
      const _exhaustive: never = destination;
      throw new Error(`unhandled destination: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// The list the moved task ends up in, which its normalized `taskListId` reports.
const destinationListId = (sourceListId: string, destination: TaskMoveDestination): string => {
  switch (destination.kind) {
    case 'sameList':
      return sourceListId;
    case 'otherList':
      return destination.taskListId;
    default: {
      const _exhaustive: never = destination;
      throw new Error(`unhandled destination: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type ValidatedMove = { readonly destination: TaskMoveDestination; readonly placement: TaskPlacement };

const validateMove = (input: MoveTaskInput): Result<ValidatedMove, InvalidInputError> =>
  validateDestination(input.destination).andThen((destination) => validateMovePlacement(input.taskId, input.placement).map((placement) => ({ destination, placement })));

// tasks.move takes everything as query parameters; the body must be empty.
const moveTask =
  (client: GoogleClient) =>
  (input: MoveTaskInput): ResultAsync<Task, GoogleError | InvalidInputError> => {
    const taskListId = resolveTaskListId(input);
    return validateMove(input).asyncAndThen((move) =>
      client
        .request({ method: 'POST', url: moveURL(taskListId, input.taskId), query: { ...placementQuery(move.placement), ...destinationQuery(move.destination) }, schema: wireTaskSchema })
        .map(toTask(destinationListId(taskListId, move.destination))),
    );
  };

// Clearing is destructive for the whole list, so the list must be named explicitly (never blank).
// Shared with the CLI and the MCP server so they can reject a blank name before looking the list up.
export const validateClearableTaskListId = (taskListId: string): Result<string, InvalidInputError> => {
  if (taskListId.trim() !== '') return ok(taskListId);
  return err(new InvalidInputError(`Invalid task list "${taskListId}": name the list to clear by its id (or '@default'); it must not be empty or only whitespace.`));
};

const clearCompletedTasks =
  (client: GoogleClient) =>
  (input: TaskListRef): ResultAsync<void, GoogleError | InvalidInputError> =>
    validateClearableTaskListId(input.taskListId).asyncAndThen((taskListId) => client.request({ method: 'POST', url: clearURL(taskListId), schema: z.undefined() }));

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

// ---------------------------------------------------------------------------------------------
// findTaskList: a list named by id or title, read with one GET when the name is an id
// ---------------------------------------------------------------------------------------------

// What a GET by id says about a name: it is a list id, or it is not one (then it may be a title).
export type TaskListLookup = { readonly kind: 'found'; readonly list: TaskListSummary } | { readonly kind: 'notAnID'; readonly query: string };

// tasklists.get answers 400 "Invalid task list ID" for a name that is not a list id (observed for both a title and an
// unknown id-shaped string); 404 is accepted too, as Google documents it for missing resources.
const isNotAnID = (error: GoogleError): boolean => error instanceof GoogleNotFoundError || (error instanceof GoogleAPIError && error.status === 400);

export const lookupTaskListByID = (tasks: ITasksService, query: string): ResultAsync<TaskListLookup, GoogleError> =>
  tasks
    .getTaskList({ taskListId: query })
    .map((list): TaskListLookup => ({ kind: 'found', list }))
    .orElse((error): ResultAsync<TaskListLookup, GoogleError> => (isNotAnID(error) ? okAsync({ kind: 'notAnID', query }) : errAsync(error)));

// A lookup that was not an id is matched against every list (by title, with the usual not-found / ambiguous errors).
export const settleTaskListLookup = (lists: readonly TaskListSummary[], lookup: TaskListLookup): Result<TaskListSummary, TaskListNotFoundError | AmbiguousTaskListError> => {
  switch (lookup.kind) {
    case 'found':
      return ok(lookup.list);
    case 'notAnID':
      return resolveTaskList(lists, lookup.query);
    default: {
      const _exhaustive: never = lookup;
      throw new Error(`unhandled task list lookup: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// An id costs one GET; only a name that is not an id lists every list (tasklists.list) to match it as a title.
export const findTaskList = (tasks: ITasksService, query: string): ResultAsync<TaskListSummary, GoogleError | TaskListNotFoundError | AmbiguousTaskListError> =>
  lookupTaskListByID(tasks, query).andThen((lookup) => {
    switch (lookup.kind) {
      case 'found':
        return okAsync(lookup.list);
      case 'notAnID':
        return tasks.listTaskLists().andThen((lists) => settleTaskListLookup(lists, lookup));
      default: {
        const _exhaustive: never = lookup;
        throw new Error(`unhandled task list lookup: ${JSON.stringify(_exhaustive)}`);
      }
    }
  });

// ---------------------------------------------------------------------------------------------
// orderTasksHierarchically: a page of tasks in outline order (each parent followed by its subtasks)
// ---------------------------------------------------------------------------------------------

// A task in outline order. `depth` counts its ancestors present in the same page: 0 = top level (also a subtask
// whose parent is not in the page), 1 = a subtask of the task above it, and so on.
export type OrderedTask = { readonly task: Task; readonly depth: number };

const parentIDOf = (hierarchy: TaskHierarchy): string | undefined => {
  switch (hierarchy.kind) {
    case 'root':
      return undefined;
    case 'subtask':
      return hierarchy.parentId;
    default: {
      const _exhaustive: never = hierarchy;
      throw new Error(`unhandled hierarchy: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Code-unit order (not locale order): positions are zero-padded digits, ids are opaque.
const compareText = (a: string, b: string): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

// Siblings by position. New tasks all get the same position (0…0), so ties go to the most recently updated
// (Google's `updated` is always UTC with milliseconds, so it compares as text), then to the id — a stable order.
const compareSiblings = (a: Task, b: Task): number => {
  const byPosition = compareText(a.position, b.position);
  if (byPosition !== 0) return byPosition;
  const byUpdated = compareText(b.updated, a.updated);
  if (byUpdated !== 0) return byUpdated;
  return compareText(a.id, b.id);
};

// Google returns a page ordered by position alone, which can put a subtask before its parent. This orders it like the
// Google Tasks app: top-level tasks by position, each followed by its subtasks (recursively). Subtasks whose parent is
// not in the page (another page, or filtered out) follow the top-level tasks, ordered the same way. No task is dropped:
// anything unreachable from those (only a malformed parent cycle) comes last at depth 0.
export const orderTasksHierarchically = (tasks: readonly Task[]): readonly OrderedTask[] => {
  const ids = new Set(tasks.map((task) => task.id));
  const isTopLevel = (task: Task): boolean => parentIDOf(task.hierarchy) === undefined;
  const isOrphan = (task: Task): boolean => {
    const parentID = parentIDOf(task.hierarchy);
    return parentID !== undefined && !ids.has(parentID);
  };
  const childrenOf = (id: string): readonly Task[] => tasks.filter((task) => parentIDOf(task.hierarchy) === id).toSorted(compareSiblings);
  const outline = (task: Task, depth: number): readonly OrderedTask[] => [{ task, depth }, ...childrenOf(task.id).flatMap((child) => outline(child, depth + 1))];

  const starts = [...tasks.filter(isTopLevel).toSorted(compareSiblings), ...tasks.filter(isOrphan).toSorted(compareSiblings)];
  const placed = starts.flatMap((task) => outline(task, 0));
  const placedIDs = new Set(placed.map(({ task }) => task.id));
  const unreachable = tasks
    .filter((task) => !placedIDs.has(task.id))
    .toSorted(compareSiblings)
    .map((task): OrderedTask => ({ task, depth: 0 }));
  return [...placed, ...unreachable];
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
  moveTask: moveTask(deps.client),
  clearCompletedTasks: clearCompletedTasks(deps.client),
});
