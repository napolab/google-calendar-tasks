import { DEFAULT_TASK_LIST_ID, findTaskList, lookupTaskListByID, settleTaskListLookup } from '@napolab/gct-core/tasks';
import { ResultAsync, ok as okResult, okAsync } from 'neverthrow';

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
  toUpdateTaskInput,
  updateTaskArgs,
} from './input';
import { toTaskListView, toTaskPageView, toTaskView } from './view';

import type { ToolDeps } from '../tool-deps';
import type { ToolError, ToolResult } from '../tool-result';
import type {
  ClearCompletedTasksArgs,
  CreateTaskArgs,
  CreateTaskListArgs,
  DeleteTaskListArgs,
  GetTaskListArgs,
  ListTarget,
  ListTasksArgs,
  ListTasksOptions,
  ListTasksQuery,
  MoveDestinationTarget,
  MoveTaskArgs,
  MoveTaskRequest,
  RenameTaskListArgs,
  TaskRefArgs,
  Targeted,
  UpdateTaskArgs,
} from './input';
import type { TaskPageView } from './view';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ITasksService, MoveTaskInput, TaskListLookup, TaskListSummary, TaskMoveDestination } from '@napolab/gct-core/tasks';
import type { Result } from 'neverthrow';

// Google Tasks tools. Each handler: arguments → core input (./input) → `list` title / id → list id
// (core findTaskList: one GET when it is an id, a title match over every list otherwise) → service call →
// normalized view (./view) → ToolResult.

// A title or id → the whole list (for tools that report which list they acted on).
const resolveNamedTaskList = (tasks: ITasksService, name: string): ResultAsync<TaskListSummary, ToolError> => findTaskList(tasks, name);

const resolveListTarget = (tasks: ITasksService, target: ListTarget): ResultAsync<string, ToolError> => {
  switch (target.kind) {
    case 'default':
      return okAsync(DEFAULT_TASK_LIST_ID);
    case 'named':
      return resolveNamedTaskList(tasks, target.name).map((list) => list.id);
    default: {
      const _exhaustive: never = target;
      throw new Error(`unhandled list target: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// The core input with its list resolved to an id.
const resolveTargeted = <T extends object>(tasks: ITasksService, targeted: Targeted<T>): ResultAsync<Omit<T, 'taskListId'> & { readonly taskListId: string }, ToolError> =>
  resolveListTarget(tasks, targeted.list).map((taskListId) => ({ ...targeted.input, taskListId }));

// The whole list a target names: '@default' is read with tasklists.get (its real id and title), a title / id is looked up.
const resolveListSummary = (tasks: ITasksService, target: ListTarget): ResultAsync<TaskListSummary, ToolError> => {
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

// The source after its lookup: '@default' passes through as Google's alias, a name has been read by id.
type SourceLookup = { readonly kind: 'alias' } | TaskListLookup;

type DestinationLookup = { readonly kind: 'sameList' } | { readonly kind: 'otherList'; readonly lookup: TaskListLookup };

const lookupSource = (tasks: ITasksService, target: ListTarget): ResultAsync<SourceLookup, ToolError> => {
  switch (target.kind) {
    case 'default':
      return okAsync({ kind: 'alias' });
    case 'named':
      return lookupTaskListByID(tasks, target.name);
    default: {
      const _exhaustive: never = target;
      throw new Error(`unhandled list target: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// destinationTasklist is not documented to take '@default', so the default list is read for its real id.
const destinationQuery = (target: ListTarget): string => {
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

const sourceNeedsTitles = (source: SourceLookup): boolean => source.kind === 'notAnID';

const destinationNeedsTitles = (destination: DestinationLookup): boolean => destination.kind === 'otherList' && destination.lookup.kind === 'notAnID';

// Every list, read only when a name was not an id.
const listsFor = (tasks: ITasksService, needed: boolean): ResultAsync<readonly TaskListSummary[], ToolError> => (needed ? tasks.listTaskLists() : okAsync([]));

const settleSource = (lists: readonly TaskListSummary[], source: SourceLookup): Result<string, ToolError> => {
  switch (source.kind) {
    case 'alias':
      return okResult(DEFAULT_TASK_LIST_ID);
    case 'found':
    case 'notAnID':
      return settleTaskListLookup(lists, source).map((list) => list.id);
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

const lookupMove = (tasks: ITasksService, request: MoveTaskRequest): ResultAsync<MoveLookups, ToolError> =>
  lookupSource(tasks, request.list).andThen((source) => lookupDestination(tasks, request.destination).map((destination) => ({ source, destination })));

const needsTitles = (lookups: MoveLookups): boolean => sourceNeedsTitles(lookups.source) || destinationNeedsTitles(lookups.destination);

const settleMove = (request: MoveTaskRequest, lists: readonly TaskListSummary[], lookups: MoveLookups): Result<MoveTaskInput, ToolError> =>
  settleSource(lists, lookups.source).andThen((taskListId) =>
    settleDestination(lists, taskListId, lookups.destination).map((destination): MoveTaskInput => ({ ...request.input, taskListId, destination })),
  );

const resolveMove = (tasks: ITasksService, request: MoveTaskRequest): ResultAsync<MoveTaskInput, ToolError> =>
  lookupMove(tasks, request).andThen((lookups) => listsFor(tasks, needsTitles(lookups)).andThen((lists) => settleMove(request, lists, lookups)));

type ListGroup = TaskPageView & { readonly title: string };

// One list's page, or every list grouped.
type TasksListing = TaskPageView | { readonly lists: readonly ListGroup[] };

const listGroup =
  (tasks: ITasksService, options: ListTasksOptions) =>
  (list: TaskListSummary): ResultAsync<ListGroup, ToolError> =>
    tasks.listTasks({ ...options, taskListId: list.id, page: { kind: 'first' } }).map((page) => ({ ...toTaskPageView(list.id, page), title: list.title }));

// Every list is read concurrently; the first failing list fails the call (a partial listing would hide tasks).
const listTasksFor = (tasks: ITasksService, query: ListTasksQuery): ResultAsync<TasksListing, ToolError> => {
  switch (query.kind) {
    case 'all':
      return tasks
        .listTaskLists()
        .andThen((lists) => ResultAsync.combine(lists.map(listGroup(tasks, query.options))))
        .map((lists): TasksListing => ({ lists }));
    case 'one':
      return resolveListTarget(tasks, query.list).andThen((taskListId) => tasks.listTasks({ ...query.options, taskListId, page: query.page }).map((page) => toTaskPageView(taskListId, page)));
    default: {
      const _exhaustive: never = query;
      throw new Error(`unhandled list query: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const createTasksToolHandlers = (deps: ToolDeps) => {
  const { tasks } = deps.services;
  const fail = toToolError(deps.connectURL, 'tasks');

  return {
    listTaskLists: (): Promise<ToolResult> =>
      tasks
        .listTaskLists()
        .map((lists) => ({ taskLists: lists.map(toTaskListView) }))
        .match(ok, fail),

    listTasks: (args: ListTasksArgs): Promise<ToolResult> =>
      toListTasksQuery(args)
        .asyncAndThen((query) => listTasksFor(tasks, query))
        .match(ok, fail),

    createTask: (args: CreateTaskArgs): Promise<ToolResult> =>
      toCreateTaskInput(args)
        .asyncAndThen((targeted) => resolveTargeted(tasks, targeted))
        .andThen((input) => tasks.createTask(input))
        .map(toTaskView)
        .match(ok, fail),

    updateTask: (args: UpdateTaskArgs): Promise<ToolResult> =>
      toUpdateTaskInput(args)
        .asyncAndThen((targeted) => resolveTargeted(tasks, targeted))
        .andThen((input) => tasks.updateTask(input))
        .map(toTaskView)
        .match(ok, fail),

    completeTask: (args: TaskRefArgs): Promise<ToolResult> =>
      resolveTargeted(tasks, toTaskRef(args))
        .andThen((ref) => tasks.completeTask(ref))
        .map(toTaskView)
        .match(ok, fail),

    reopenTask: (args: TaskRefArgs): Promise<ToolResult> =>
      resolveTargeted(tasks, toTaskRef(args))
        .andThen((ref) => tasks.reopenTask(ref))
        .map(toTaskView)
        .match(ok, fail),

    getTask: (args: TaskRefArgs): Promise<ToolResult> =>
      resolveTargeted(tasks, toTaskRef(args))
        .andThen((ref) => tasks.getTask(ref))
        .map(toTaskView)
        .match(ok, fail),

    moveTask: (args: MoveTaskArgs): Promise<ToolResult> =>
      toMoveTaskRequest(args)
        .asyncAndThen((request) => resolveMove(tasks, request))
        .andThen((input) => tasks.moveTask(input))
        .map(toTaskView)
        .match(ok, fail),

    clearCompletedTasks: (args: ClearCompletedTasksArgs): Promise<ToolResult> =>
      toClearTaskListTarget(args)
        .asyncAndThen((target) => resolveListSummary(tasks, target))
        .andThen((list) => tasks.clearCompletedTasks({ taskListId: list.id }).map(() => ({ cleared: true, taskList: toTaskListView(list) })))
        .match(ok, fail),

    deleteTask: (args: TaskRefArgs): Promise<ToolResult> =>
      resolveTargeted(tasks, toTaskRef(args))
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
        .asyncAndThen((targeted) => resolveTargeted(tasks, targeted))
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

const LIST_HELP = "list is a task list id or title (from list_task_lists) or '@default'; default: the user's default list.";

export const registerTasksTools = (server: McpServer, deps: ToolDeps): void => {
  const handlers = createTasksToolHandlers(deps);

  server.registerTool(
    'list_task_lists',
    { title: 'List task lists', description: "List the user's Google Tasks lists with their ids and titles.", annotations: { readOnlyHint: true } },
    handlers.listTaskLists,
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        "List tasks. Without list: EVERY list, grouped ({ lists: [{ taskListId, title, tasks, nextPageToken }] }). With list (id, title or '@default'): that list only. Completed tasks are included by default; deleted and assigned (Docs / Chat) tasks only with showDeleted / showAssigned. dueFrom / dueTo are inclusive YYYY-MM-DD days. updatedMin / completedMin / completedMax take RFC 3339 with an offset or YYYY-MM-DD (a day in Asia/Tokyo). updatedMin / completedMin are inclusive (a task at exactly that instant is listed); a completedMax day reaches the end of that day.",
      inputSchema: listTasksArgs,
      annotations: { readOnlyHint: true },
    },
    handlers.listTasks,
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get task',
      description: `Get one task by id with its notes, due day, parent, position, links, deleted / hidden flags and assignment source. ${LIST_HELP}`,
      inputSchema: taskRefArgs,
      annotations: { readOnlyHint: true },
    },
    handlers.getTask,
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description: `Create a task. due is a day (YYYY-MM-DD; Google Tasks has no due time). parentId makes it a subtask; previousId places it after a sibling. ${LIST_HELP}`,
      inputSchema: createTaskArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    handlers.createTask,
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description: `Change a task's title, notes or due day. Omitted fields are kept; remove notes / due with clearNotes / clearDue: true (never an empty string). Use complete_task / reopen_task for the status. ${LIST_HELP}`,
      inputSchema: updateTaskArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handlers.updateTask,
  );

  server.registerTool(
    'complete_task',
    { title: 'Complete task', description: `Mark a task completed. ${LIST_HELP}`, inputSchema: taskRefArgs, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
    handlers.completeTask,
  );

  server.registerTool(
    'reopen_task',
    {
      title: 'Reopen task',
      description: `Mark a completed task as not completed. ${LIST_HELP}`,
      inputSchema: taskRefArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handlers.reopenTask,
  );

  server.registerTool(
    'move_task',
    {
      title: 'Move task',
      description:
        "Reorder, nest / un-nest, or move a task to another list. The placement is always rewritten: parentId makes it a subtask (omit it to put the task at the TOP LEVEL — this un-nests a subtask), previousId places it after that sibling (omit it to place it first). destinationList (id, title or '@default') moves it into another list; omit it to stay in list. Recurring tasks cannot change lists, and assigned tasks cannot be nested. Returns the moved task.",
      inputSchema: moveTaskArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handlers.moveTask,
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: `Delete a task by id. Cannot be undone — confirm the id with list_tasks first. ${LIST_HELP}`,
      inputSchema: taskRefArgs,
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
      description: "Get one task list's id, title and last update. list is an id or a title from list_task_lists, or '@default' (returns the default list's real id).",
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
        "Delete a whole task list AND EVERY TASK IN IT. Cannot be undone — call list_task_lists first and pass the exact id of the list the user asked to delete (a title also works when it is unique). The default list cannot be deleted ('@default' is rejected). Returns the deleted list.",
      inputSchema: deleteTaskListArgs,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    handlers.deleteTaskList,
  );
};
