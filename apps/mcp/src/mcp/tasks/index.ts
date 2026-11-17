import { TaskListNotFoundError } from '@napolab/gct-core/errors';
import { DEFAULT_TASK_LIST_ID, findTaskList, lookupTaskListByID, setTaskBoardStatus, settleTaskListLookup } from '@napolab/gct-core/tasks';
import { ResultAsync, ok as okResult, okAsync } from 'neverthrow';

import { DefaultTaskListNotFoundError } from '../../errors';
import { ok, toToolError } from '../tool-result';
import {
  clearCompletedTasksArgs,
  createTaskArgs,
  createTaskListArgs,
  deleteTaskListArgs,
  getTaskListArgs,
  listTasksArgs,
  moveTaskArgs,
  renameTaskListArgs,
  setTaskStatusArgs,
  taskRefArgs,
  toClearTaskListTarget,
  toCreateTaskInput,
  toCreateTaskListInput,
  toDeleteTaskListName,
  toGetTaskListTarget,
  toListTasksQuery,
  toMoveTaskRequest,
  toRenameTaskListInput,
  toTaskRef,
  toTaskStatusChange,
  toUpdateTaskInput,
  updateTaskArgs,
} from './input';
import { toTaskListPageView, toTaskListView, toTaskView } from './view';

import type { ToolDeps } from '../tool-deps';
import type { ToolError, ToolResult } from '../tool-result';
import type {
  ClearCompletedTasksArgs,
  CreateTaskArgs,
  CreateTaskListArgs,
  DeleteTaskListArgs,
  ExplicitListTarget,
  GetTaskListArgs,
  ListTarget,
  ListTasksArgs,
  ListTasksOptions,
  ListTasksQuery,
  MoveDestinationTarget,
  MoveTaskArgs,
  MoveTaskRequest,
  RenameTaskListArgs,
  SetTaskStatusArgs,
  TaskRefArgs,
  Targeted,
  UpdateTaskArgs,
} from './input';
import type { TaskListPageView } from './view';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ITasksService, MoveTaskInput, TaskListLookup, TaskListSummary, TaskMoveDestination, TaskPageRequest } from '@napolab/gct-core/tasks';
import type { Result } from 'neverthrow';

// Google Tasks tools. Each handler: arguments → core input (./input) → `list` title / id → list id
// (core findTaskList: one GET when it is an id, a title match over every list otherwise) → service call →
// normalized view (./view) → ToolResult.

// A title or id → the whole list (for tools that report which list they acted on).
const resolveNamedTaskList = (tasks: ITasksService, name: string): ResultAsync<TaskListSummary, ToolError> => findTaskList(tasks, name);

// The caller did not name the configured default list, so "no such list" is reworded to say where the name came from.
const explainDefaultListMiss = (error: ToolError): ToolError => (error instanceof TaskListNotFoundError ? new DefaultTaskListNotFoundError(error.query, error.titles) : error);

// The configured default list (ToolDeps.defaultTaskList): a title or an id, looked up like a named list.
const resolveConfiguredDefault = (tasks: ITasksService, defaultTaskList: string): ResultAsync<TaskListSummary, ToolError> => findTaskList(tasks, defaultTaskList).mapErr(explainDefaultListMiss);

const resolveListTarget = (tasks: ITasksService, target: ListTarget, defaultTaskList: string): ResultAsync<string, ToolError> => {
  switch (target.kind) {
    case 'default':
      return okAsync(DEFAULT_TASK_LIST_ID);
    case 'named':
      return resolveNamedTaskList(tasks, target.name).map((list) => list.id);
    case 'configuredDefault':
      return resolveConfiguredDefault(tasks, defaultTaskList).map((list) => list.id);
    default: {
      const _exhaustive: never = target;
      throw new Error(`unhandled list target: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// The core input with its list resolved to an id.
const resolveTargeted = <T extends object>(tasks: ITasksService, targeted: Targeted<T>, defaultTaskList: string): ResultAsync<Omit<T, 'taskListId'> & { readonly taskListId: string }, ToolError> =>
  resolveListTarget(tasks, targeted.list, defaultTaskList).map((taskListId) => ({ ...targeted.input, taskListId }));

// The whole list a target names: '@default' is read with tasklists.get (its real id and title), a title / id is looked up.
export const resolveListSummary = (tasks: ITasksService, target: ExplicitListTarget): ResultAsync<TaskListSummary, ToolError> => {
  switch (target.kind) {
    case 'default':
      return tasks.getTaskList({ taskListId: DEFAULT_TASK_LIST_ID });
    case 'named':
      return resolveNamedTaskList(tasks, target.name);
    default: {
      const _exhaustive: never = target;
      throw new Error(`unhandled list target: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// ---- move_task: each named list is read by id first; titles left over share one listTaskLists call ----

// The source after its lookup: '@default' passes through as Google's alias; a name — given, or the configured default
// list when `list` was omitted — has been read by id.
type SourceLookup = { readonly kind: 'alias' } | { readonly kind: 'named'; readonly lookup: TaskListLookup } | { readonly kind: 'configuredDefault'; readonly lookup: TaskListLookup };

type DestinationLookup = { readonly kind: 'sameList' } | { readonly kind: 'otherList'; readonly lookup: TaskListLookup };

const lookupSource = (tasks: ITasksService, target: ListTarget, defaultTaskList: string): ResultAsync<SourceLookup, ToolError> => {
  switch (target.kind) {
    case 'default':
      return okAsync({ kind: 'alias' });
    case 'named':
      return lookupTaskListByID(tasks, target.name).map((lookup): SourceLookup => ({ kind: 'named', lookup }));
    case 'configuredDefault':
      return lookupTaskListByID(tasks, defaultTaskList).map((lookup): SourceLookup => ({ kind: 'configuredDefault', lookup }));
    default: {
      const _exhaustive: never = target;
      throw new Error(`unhandled list target: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// destinationTasklist is not documented to take '@default', so the default list is read for its real id.
const destinationQuery = (target: ExplicitListTarget): string => {
  switch (target.kind) {
    case 'default':
      return DEFAULT_TASK_LIST_ID;
    case 'named':
      return target.name;
    default: {
      const _exhaustive: never = target;
      throw new Error(`unhandled list target: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const lookupDestination = (tasks: ITasksService, destination: MoveDestinationTarget): ResultAsync<DestinationLookup, ToolError> => {
  switch (destination.kind) {
    case 'sameList':
      return okAsync({ kind: 'sameList' });
    case 'otherList':
      return lookupTaskListByID(tasks, destinationQuery(destination.list)).map((lookup): DestinationLookup => ({ kind: 'otherList', lookup }));
    default: {
      const _exhaustive: never = destination;
      throw new Error(`unhandled destination: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const sourceNeedsTitles = (source: SourceLookup): boolean => source.kind !== 'alias' && source.lookup.kind === 'notAnID';

const destinationNeedsTitles = (destination: DestinationLookup): boolean => destination.kind === 'otherList' && destination.lookup.kind === 'notAnID';

// Every list, read only when a name was not an id.
const listsFor = (tasks: ITasksService, needed: boolean): ResultAsync<readonly TaskListSummary[], ToolError> => (needed ? tasks.listTaskLists() : okAsync([]));

const settleSource = (lists: readonly TaskListSummary[], source: SourceLookup): Result<string, ToolError> => {
  switch (source.kind) {
    case 'alias':
      return okResult(DEFAULT_TASK_LIST_ID);
    case 'named':
      return settleTaskListLookup(lists, source.lookup).map((list) => list.id);
    case 'configuredDefault':
      return settleTaskListLookup(lists, source.lookup)
        .mapErr(explainDefaultListMiss)
        .map((list) => list.id);
    default: {
      const _exhaustive: never = source;
      throw new Error(`unhandled source lookup: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// A destination that resolves to the source list is a move within it.
const toMoveDestination = (sourceId: string, destinationId: string): TaskMoveDestination => (destinationId === sourceId ? { kind: 'sameList' } : { kind: 'otherList', taskListId: destinationId });

const settleDestination = (lists: readonly TaskListSummary[], sourceId: string, destination: DestinationLookup): Result<TaskMoveDestination, ToolError> => {
  switch (destination.kind) {
    case 'sameList':
      return okResult({ kind: 'sameList' });
    case 'otherList':
      return settleTaskListLookup(lists, destination.lookup).map((list) => toMoveDestination(sourceId, list.id));
    default: {
      const _exhaustive: never = destination;
      throw new Error(`unhandled destination lookup: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type MoveLookups = { readonly source: SourceLookup; readonly destination: DestinationLookup };

const lookupMove = (tasks: ITasksService, request: MoveTaskRequest, defaultTaskList: string): ResultAsync<MoveLookups, ToolError> =>
  lookupSource(tasks, request.list, defaultTaskList).andThen((source) => lookupDestination(tasks, request.destination).map((destination) => ({ source, destination })));

const needsTitles = (lookups: MoveLookups): boolean => sourceNeedsTitles(lookups.source) || destinationNeedsTitles(lookups.destination);

const settleMove = (request: MoveTaskRequest, lists: readonly TaskListSummary[], lookups: MoveLookups): Result<MoveTaskInput, ToolError> =>
  settleSource(lists, lookups.source).andThen((taskListId) =>
    settleDestination(lists, taskListId, lookups.destination).map((destination): MoveTaskInput => ({ ...request.input, taskListId, destination })),
  );

const resolveMove = (tasks: ITasksService, request: MoveTaskRequest, defaultTaskList: string): ResultAsync<MoveTaskInput, ToolError> =>
  lookupMove(tasks, request, defaultTaskList).andThen((lookups) => listsFor(tasks, needsTitles(lookups)).andThen((lists) => settleMove(request, lists, lookups)));

// list_tasks always answers `{ lists }`: one entry per list read (exactly one when `list` is given).
export type TasksListing = { readonly lists: readonly TaskListPageView[] };

const listPage =
  (tasks: ITasksService, options: ListTasksOptions, page: TaskPageRequest) =>
  (list: TaskListSummary): ResultAsync<TaskListPageView, ToolError> =>
    tasks.listTasks({ ...options, taskListId: list.id, page }).map((taskPage) => toTaskListPageView(list, taskPage));

// Every list is read concurrently; the first failing list fails the call (a partial listing would hide tasks).
// One list is resolved to its summary for the title: a name costs no extra call, '@default' one tasklists.get.
const listTasksFor = (tasks: ITasksService, query: ListTasksQuery): ResultAsync<TasksListing, ToolError> => {
  switch (query.kind) {
    case 'all':
      return tasks
        .listTaskLists()
        .andThen((lists) => ResultAsync.combine(lists.map(listPage(tasks, query.options, { kind: 'first' }))))
        .map((lists): TasksListing => ({ lists }));
    case 'one':
      return resolveListSummary(tasks, query.list)
        .andThen(listPage(tasks, query.options, query.page))
        .map((list): TasksListing => ({ lists: [list] }));
    default: {
      const _exhaustive: never = query;
      throw new Error(`unhandled list query: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// list_tasks' read, also used by show_task_board (task-board): arguments → query → every list (or one) with its tasks.
export const readTasksListing = (tasks: ITasksService, args: ListTasksArgs): ResultAsync<TasksListing, ToolError> => toListTasksQuery(args).asyncAndThen((query) => listTasksFor(tasks, query));

export const createTasksToolHandlers = (deps: ToolDeps) => {
  const { tasks } = deps.services;
  const { defaultTaskList } = deps;
  const fail = toToolError(deps.connectURL, 'tasks');

  return {
    listTaskLists: (): Promise<ToolResult> =>
      tasks
        .listTaskLists()
        .map((lists) => ({ taskLists: lists.map(toTaskListView) }))
        .match(ok, fail),

    listTasks: (args: ListTasksArgs): Promise<ToolResult> => readTasksListing(tasks, args).match(ok, fail),

    createTask: (args: CreateTaskArgs): Promise<ToolResult> =>
      toCreateTaskInput(args)
        .asyncAndThen((targeted) => resolveTargeted(tasks, targeted, defaultTaskList))
        .andThen((input) => tasks.createTask(input))
        .map(toTaskView)
        .match(ok, fail),

    updateTask: (args: UpdateTaskArgs): Promise<ToolResult> =>
      toUpdateTaskInput(args)
        .asyncAndThen((targeted) => resolveTargeted(tasks, targeted, defaultTaskList))
        .andThen((input) => tasks.updateTask(input))
        .map(toTaskView)
        .match(ok, fail),

    completeTask: (args: TaskRefArgs): Promise<ToolResult> =>
      resolveTargeted(tasks, toTaskRef(args), defaultTaskList)
        .andThen((ref) => tasks.completeTask(ref))
        .map(toTaskView)
        .match(ok, fail),

    reopenTask: (args: TaskRefArgs): Promise<ToolResult> =>
      resolveTargeted(tasks, toTaskRef(args), defaultTaskList)
        .andThen((ref) => tasks.reopenTask(ref))
        .map(toTaskView)
        .match(ok, fail),

    setTaskStatus: (args: SetTaskStatusArgs): Promise<ToolResult> => {
      const change = toTaskStatusChange(args);
      return resolveTargeted(tasks, change.ref, defaultTaskList)
        .andThen((ref) => setTaskBoardStatus(tasks, ref, change.status))
        .map(toTaskView)
        .match(ok, fail);
    },

    getTask: (args: TaskRefArgs): Promise<ToolResult> =>
      resolveTargeted(tasks, toTaskRef(args), defaultTaskList)
        .andThen((ref) => tasks.getTask(ref))
        .map(toTaskView)
        .match(ok, fail),

    moveTask: (args: MoveTaskArgs): Promise<ToolResult> =>
      toMoveTaskRequest(args)
        .asyncAndThen((request) => resolveMove(tasks, request, defaultTaskList))
        .andThen((input) => tasks.moveTask(input))
        .map(toTaskView)
        .match(ok, fail),

    clearCompletedTasks: (args: ClearCompletedTasksArgs): Promise<ToolResult> =>
      toClearTaskListTarget(args)
        .asyncAndThen((target) => resolveListSummary(tasks, target))
        .andThen((list) => tasks.clearCompletedTasks({ taskListId: list.id }).map(() => ({ cleared: true, taskList: toTaskListView(list) })))
        .match(ok, fail),

    deleteTask: (args: TaskRefArgs): Promise<ToolResult> =>
      resolveTargeted(tasks, toTaskRef(args), defaultTaskList)
        .andThen((ref) => tasks.deleteTask(ref).map(() => ({ deleted: true, taskListId: ref.taskListId, taskId: ref.taskId })))
        .match(ok, fail),

    getTaskList: (args: GetTaskListArgs): Promise<ToolResult> => resolveListSummary(tasks, toGetTaskListTarget(args)).map(toTaskListView).match(ok, fail),

    createTaskList: (args: CreateTaskListArgs): Promise<ToolResult> =>
      toCreateTaskListInput(args)
        .asyncAndThen((input) => tasks.createTaskList(input))
        .map(toTaskListView)
        .match(ok, fail),

    renameTaskList: (args: RenameTaskListArgs): Promise<ToolResult> =>
      toRenameTaskListInput(args)
        .asyncAndThen((targeted) => resolveTargeted(tasks, targeted, defaultTaskList))
        .andThen((input) => tasks.renameTaskList(input))
        .map(toTaskListView)
        .match(ok, fail),

    deleteTaskList: (args: DeleteTaskListArgs): Promise<ToolResult> =>
      toDeleteTaskListName(args)
        .asyncAndThen((name) => resolveNamedTaskList(tasks, name))
        .andThen((list) => tasks.deleteTaskList({ taskListId: list.id }).map(() => ({ deleted: true, taskList: toTaskListView(list) })))
        .match(ok, fail),
  };
};

// Quoted in every tool whose `list` is optional: omitted means the configured default list.
const listHelp = (defaultTaskList: string): string =>
  `list is a task list id or title (from list_task_lists) or '@default' (Google's own default list); omitted: the "${defaultTaskList}" list. For a task found with list_tasks, pass the taskListId it was listed under.`;

// The status-tag template (core tasks/status-tag), quoted in every tool that reads or writes notes.
const STATUS_TAG_HELP =
  "Board status: the FIRST line of notes may be a tag '[status: todo]', '[status: doing]' or '[status: done]'; the rest is the body. Each task carries notes (raw, tag included), body (without the tag line), boardStatus (todo / doing / done: done whenever the task is completed, else the tag; no or unknown tag = todo) and unknownStatusTag (an unrecognized tag value, else null). Change the column with set_task_status, not by editing notes.";

export const registerTasksTools = (server: McpServer, deps: ToolDeps): void => {
  const handlers = createTasksToolHandlers(deps);
  const listHelpText = listHelp(deps.defaultTaskList);
  const taskRefSchema = taskRefArgs(deps.defaultTaskList);

  server.registerTool(
    'list_task_lists',
    { title: 'List task lists', description: "List the user's Google Tasks lists with their ids and titles.", annotations: { readOnlyHint: true } },
    handlers.listTaskLists,
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description: `List tasks. Always returns { lists: [{ taskListId, title, tasks, nextPageToken }] }: without list, one entry per task list (EVERY list); with list (id, title or '@default'), exactly one entry for that list (its real id, even for '@default'). Within a page, tasks are in outline order: each top-level task (by position) is followed by its subtasks; each task carries parentId and depth (0 = top level, 1 = subtask of the task above). ${STATUS_TAG_HELP} A subtask whose parent is on another page or filtered out comes after the top-level tasks with depth 0 and a non-null parentId. Completed tasks are included by default; deleted and assigned (Docs / Chat) tasks only with showDeleted / showAssigned. dueFrom / dueTo are inclusive YYYY-MM-DD days. updatedMin / completedMin / completedMax take RFC 3339 with an offset or YYYY-MM-DD (a day in Asia/Tokyo). updatedMin / completedMin are inclusive (a task at exactly that instant is listed); a completedMax day reaches the end of that day.`,
      inputSchema: listTasksArgs,
      annotations: { readOnlyHint: true },
    },
    handlers.listTasks,
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get task',
      description: `Get one task by id with its notes, due day, parent, position, links, deleted / hidden flags and assignment source. ${STATUS_TAG_HELP} ${listHelpText}`,
      inputSchema: taskRefSchema,
      annotations: { readOnlyHint: true },
    },
    handlers.getTask,
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description: `Create a task. due is a day (YYYY-MM-DD; Google Tasks has no due time). parentId makes it a subtask; previousId places it after a sibling. status ('todo' / 'doing') writes the board status tag as the first line of the notes. ${listHelpText}`,
      inputSchema: createTaskArgs(deps.defaultTaskList),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    handlers.createTask,
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description: `Change a task's title, notes or due day. Omitted fields are kept; remove notes / due with clearNotes / clearDue: true (never an empty string). notes replaces the RAW notes: keep the first-line '[status: …]' tag when the task has one (copy it from get_task's notes), or the task drops back to todo on the board. Use set_task_status (or complete_task / reopen_task) for the status. ${listHelpText}`,
      inputSchema: updateTaskArgs(deps.defaultTaskList),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handlers.updateTask,
  );

  server.registerTool(
    'complete_task',
    { title: 'Complete task', description: `Mark a task completed. ${listHelpText}`, inputSchema: taskRefSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    handlers.completeTask,
  );

  server.registerTool(
    'reopen_task',
    {
      title: 'Reopen task',
      description: `Mark a completed task as not completed. ${listHelpText}`,
      inputSchema: taskRefSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handlers.reopenTask,
  );

  server.registerTool(
    'set_task_status',
    {
      title: 'Set task board status',
      description: `Move a task to a board column. 'done' completes the task and rewrites the first line of its notes to '[status: done]'; 'todo' / 'doing' reopen it (if completed) and write '[status: todo]' / '[status: doing]'. The rest of the notes is kept as is. Returns the task with its boardStatus. ${listHelpText}`,
      inputSchema: setTaskStatusArgs(deps.defaultTaskList),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handlers.setTaskStatus,
  );

  server.registerTool(
    'move_task',
    {
      title: 'Move task',
      description: `Reorder, nest / un-nest, or move a task to another list. The placement is always rewritten: parentId makes it a subtask (omit it to put the task at the TOP LEVEL — this un-nests a subtask), previousId places it after that sibling (omit it to place it first). destinationList (id, title or '@default') moves it into another list; omit it to stay in list. Recurring tasks cannot change lists, and assigned tasks cannot be nested. Returns the moved task. ${listHelpText}`,
      inputSchema: moveTaskArgs(deps.defaultTaskList),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handlers.moveTask,
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: `Delete a task by id. Cannot be undone — confirm the id with list_tasks first. ${listHelpText}`,
      inputSchema: taskRefSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    handlers.deleteTask,
  );

  server.registerTool(
    'clear_completed_tasks',
    {
      title: 'Clear completed tasks',
      description:
        "Hide EVERY completed task of one list (Google's 'clear completed'). They disappear from list_tasks unless completed is 'includeHidden'; there is no un-clear. Only when the user asked for it: pass list (id, title from list_task_lists, or '@default') and confirm: 'clear-completed'. Returns the cleared list.",
      inputSchema: clearCompletedTasksArgs,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    handlers.clearCompletedTasks,
  );

  server.registerTool(
    'get_task_list',
    {
      title: 'Get task list',
      description: "Get one task list's id, title and last update. list is an id or a title from list_task_lists, or '@default' (returns Google's own default list with its real id).",
      inputSchema: getTaskListArgs,
      annotations: { readOnlyHint: true },
    },
    handlers.getTaskList,
  );

  server.registerTool(
    'create_task_list',
    {
      title: 'Create task list',
      description: 'Create a new Google Tasks list. title must be non-empty (at most 1024 characters). Returns the new list with its id, which list / create_task take.',
      inputSchema: createTaskListArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    handlers.createTaskList,
  );

  server.registerTool(
    'rename_task_list',
    {
      title: 'Rename task list',
      description:
        "Change a task list's title (its id and tasks stay the same). list is a task list id or title from list_task_lists, or '@default'. title must be non-empty (at most 1024 characters).",
      inputSchema: renameTaskListArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handlers.renameTaskList,
  );

  server.registerTool(
    'delete_task_list',
    {
      title: 'Delete task list',
      description:
        "Delete a whole task list AND EVERY TASK IN IT. Cannot be undone — call list_task_lists first and pass the exact id of the list the user asked to delete (a title also works when it is unique). Google's own default list cannot be deleted ('@default' is rejected). Returns the deleted list.",
      inputSchema: deleteTaskListArgs,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    handlers.deleteTaskList,
  );
};
