import { DEFAULT_TASK_LIST_ID, resolveTaskList } from '@napolab/gct-core/tasks';
import { ResultAsync, okAsync } from 'neverthrow';

import { ok, toToolError } from '../tool-result';
import {
  createTaskArgs,
  createTaskListArgs,
  deleteTaskListArgs,
  listTasksArgs,
  renameTaskListArgs,
  taskRefArgs,
  toCreateTaskInput,
  toCreateTaskListInput,
  toDeleteTaskListName,
  toListTasksQuery,
  toRenameTaskListInput,
  toTaskRef,
  toUpdateTaskInput,
  updateTaskArgs,
} from './input';
import { toTaskListView, toTaskPageView, toTaskView } from './view';

import type { ToolDeps } from '../tool-deps';
import type { ToolError, ToolResult } from '../tool-result';
import type {
  CreateTaskArgs,
  CreateTaskListArgs,
  DeleteTaskListArgs,
  ListTarget,
  ListTasksArgs,
  ListTasksOptions,
  ListTasksQuery,
  RenameTaskListArgs,
  TaskRefArgs,
  Targeted,
  UpdateTaskArgs,
} from './input';
import type { TaskPageView } from './view';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ITasksService, TaskListSummary } from '@napolab/gct-core/tasks';

// Google Tasks tools. Each handler: arguments → core input (./input) → `list` title / id → list id
// (core resolveTaskList) → service call → normalized view (./view) → ToolResult.

// A title or id → the whole list (for tools that report which list they acted on).
const resolveNamedTaskList = (tasks: ITasksService, name: string): ResultAsync<TaskListSummary, ToolError> => tasks.listTaskLists().andThen((lists) => resolveTaskList(lists, name));

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
  const fail = toToolError(deps.connectURL);

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

    deleteTask: (args: TaskRefArgs): Promise<ToolResult> =>
      resolveTargeted(tasks, toTaskRef(args))
        .andThen((ref) => tasks.deleteTask(ref).map(() => ({ deleted: true, taskListId: ref.taskListId, taskId: ref.taskId })))
        .match(ok, fail),

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
        "List tasks. Without list: EVERY list, grouped ({ lists: [{ taskListId, title, tasks, nextPageToken }] }). With list (id, title or '@default'): that list only. Completed tasks are included by default. dueFrom / dueTo are inclusive YYYY-MM-DD days.",
      inputSchema: listTasksArgs,
      annotations: { readOnlyHint: true },
    },
    handlers.listTasks,
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
