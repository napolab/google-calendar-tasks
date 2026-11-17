import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { prefixed, renderWith, report, reportMissingSubcommand, toJSONText } from '../shared/output';
import { listTasksInAllLists } from './all-lists';
import { formatTaskLine, formatTaskListsTasks, formatTaskPage } from './format';
import { toCreateTaskInput, toListTasksQuery, toTaskRef, toUpdateTaskInput } from './input';
import { resolveListTarget, resolveTargeted } from './task-list';

import type { CliContext } from '../../context';
import type { CommandError } from '../shared/output';
import type { TaskListTasks } from './all-lists';
import type { ListTasksQuery } from './input';
import type { ITasksService, TaskPage } from '@napolab/gct-core/tasks';
import type { ArgValues } from 'gunshi';
import type { ResultAsync } from 'neverthrow';

// `gct tasks list|add|update|complete|reopen|delete`. Handlers only wire: flags → core input (pure, ./input) →
// context.services() → `--list` title / id → list id (./task-list) → service call → render (./format).
// Input is validated before any Google call.

export type DeletedTask = { readonly kind: 'deleted'; readonly taskListId: string; readonly taskId: string };

const formatDeleted = (deleted: DeletedTask): string => `Deleted task ${deleted.taskId} from list ${deleted.taskListId}.`;

const LIST_VALUE = "a task list title or id, or @default (see 'gct tasklists')";

// `tasks list` reads one list (its page, JSON unchanged) or every list (one group per list).
type ListedTasks = { readonly kind: 'one'; readonly page: TaskPage } | { readonly kind: 'all'; readonly lists: readonly TaskListTasks[] };

const listTasksFor = (tasks: ITasksService, query: ListTasksQuery): ResultAsync<ListedTasks, CommandError> => {
  switch (query.kind) {
    case 'all':
      return listTasksInAllLists(tasks, query.options).map((lists): ListedTasks => ({ kind: 'all', lists }));
    case 'one':
      return resolveListTarget(tasks, query.list)
        .andThen((taskListId) => tasks.listTasks({ ...query.options, taskListId, page: query.page }))
        .map((page): ListedTasks => ({ kind: 'one', page }));
    default: {
      const _exhaustive: never = query;
      throw new Error(`unhandled list query: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const renderListedTasks =
  (json: boolean | undefined) =>
  (listed: ListedTasks): string => {
    switch (listed.kind) {
      case 'one':
        return renderWith(json, formatTaskPage)(listed.page);
      case 'all':
        return renderWith(json, formatTaskListsTasks)(listed.lists);
      default: {
        const _exhaustive: never = listed;
        throw new Error(`unhandled listing: ${toJSONText(_exhaustive)}`);
      }
    }
  };

export const runListTasks = (ctx: CliContext, values: ListTasksValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toListTasksQuery(values))
      .asyncAndThen((query) => ctx.services().andThen((services) => listTasksFor(services.tasks, query))),
    renderListedTasks(values.json),
  );

export const runAddTask = (ctx: CliContext, values: AddTaskValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toCreateTaskInput(values.title, values))
      .asyncAndThen((targeted) => ctx.services().andThen((services) => resolveTargeted(services.tasks, targeted).andThen((input) => services.tasks.createTask(input)))),
    renderWith(values.json, prefixed('Added: ', formatTaskLine)),
  );

export const runUpdateTask = (ctx: CliContext, values: UpdateTaskValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toUpdateTaskInput(values.taskId, values))
      .asyncAndThen((targeted) => ctx.services().andThen((services) => resolveTargeted(services.tasks, targeted).andThen((input) => services.tasks.updateTask(input)))),
    renderWith(values.json, prefixed('Updated: ', formatTaskLine)),
  );

export const runCompleteTask = (ctx: CliContext, values: CompleteTaskValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() =>
      ctx.services().andThen((services) => resolveTargeted(services.tasks, toTaskRef(values.taskId, values)).andThen((ref) => services.tasks.completeTask(ref))),
    ),
    renderWith(values.json, prefixed('Completed: ', formatTaskLine)),
  );

export const runReopenTask = (ctx: CliContext, values: ReopenTaskValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => resolveTargeted(services.tasks, toTaskRef(values.taskId, values)).andThen((ref) => services.tasks.reopenTask(ref)))),
    renderWith(values.json, prefixed('Reopened: ', formatTaskLine)),
  );

export const runDeleteTask = (ctx: CliContext, values: DeleteTaskValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() =>
      ctx
        .services()
        .andThen((services) =>
          resolveTargeted(services.tasks, toTaskRef(values.taskId, values)).andThen((ref) => services.tasks.deleteTask(ref).map((): DeletedTask => ({ kind: 'deleted', ...ref }))),
        ),
    ),
    renderWith(values.json, formatDeleted),
  );

export const createListTasksCommand = (context: CliContext) =>
  define({
    name: 'list',
    description: 'List tasks grouped by task list (default: every list, completed included, up to 100 per list; --list for one list)',
    args: {
      list: { type: 'string', description: `Only this task list: ${LIST_VALUE} (default: every list)` },
      dueFrom: { type: 'string', description: 'Only tasks due on or after this date (YYYY-MM-DD)' },
      dueTo: { type: 'string', description: 'Only tasks due on or before this date (YYYY-MM-DD)' },
      completed: {
        type: 'enum',
        choices: ['exclude', 'include', 'hidden'] as const,
        default: 'include',
        description: 'Completed tasks: exclude, include, or hidden (also those completed in Google apps, which Google hides)',
      },
      max: { type: 'number', default: 100, description: 'Tasks per page (1-100)' },
      pageToken: { type: 'string', description: 'Page token printed by the previous page (needs --list: a token belongs to one list)' },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runListTasks(context, ctx.values, extraArgsOf(ctx, 0)),
  });

export const createAddTaskCommand = (context: CliContext) =>
  define({
    name: 'add',
    description: 'Add a task',
    args: {
      title: { type: 'positional', description: 'Task title (quote it when it has spaces)' },
      notes: { type: 'string', description: 'Task notes' },
      due: { type: 'string', description: 'Due date (YYYY-MM-DD; Google Tasks has no due time)' },
      parent: { type: 'string', description: 'Create as a subtask of this task id' },
      after: { type: 'string', description: 'Place after this sibling task id (default: first)' },
      list: { type: 'string', description: `Task list: ${LIST_VALUE} (default: your default list)` },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runAddTask(context, ctx.values, extraArgsOf(ctx, 1)),
  });

export const createUpdateTaskCommand = (context: CliContext) =>
  define({
    name: 'update',
    description: 'Change a task: --<field> sets, --clear-<field> removes, absent flags keep the current value',
    args: {
      taskId: { type: 'positional', description: 'Task id (shown in brackets by `gct tasks list`)' },
      title: { type: 'string', description: 'New title' },
      notes: { type: 'string', description: 'New notes' },
      clearNotes: { type: 'boolean', description: 'Remove the notes' },
      due: { type: 'string', description: 'New due date (YYYY-MM-DD)' },
      clearDue: { type: 'boolean', description: 'Remove the due date' },
      list: { type: 'string', description: `Task list: ${LIST_VALUE} (default: your default list)` },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runUpdateTask(context, ctx.values, extraArgsOf(ctx, 1)),
  });

export const createCompleteTaskCommand = (context: CliContext) =>
  define({
    name: 'complete',
    description: 'Mark a task completed',
    args: {
      taskId: { type: 'positional', description: 'Task id (shown in brackets by `gct tasks list`)' },
      list: { type: 'string', description: `Task list: ${LIST_VALUE} (default: your default list)` },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runCompleteTask(context, ctx.values, extraArgsOf(ctx, 1)),
  });

export const createReopenTaskCommand = (context: CliContext) =>
  define({
    name: 'reopen',
    description: 'Mark a completed task as not completed',
    args: {
      taskId: { type: 'positional', description: 'Task id (shown in brackets by `gct tasks list`)' },
      list: { type: 'string', description: `Task list: ${LIST_VALUE} (default: your default list)` },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runReopenTask(context, ctx.values, extraArgsOf(ctx, 1)),
  });

export const createDeleteTaskCommand = (context: CliContext) =>
  define({
    name: 'delete',
    description: 'Delete a task',
    args: {
      taskId: { type: 'positional', description: 'Task id (shown in brackets by `gct tasks list`)' },
      list: { type: 'string', description: `Task list: ${LIST_VALUE} (default: your default list)` },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runDeleteTask(context, ctx.values, extraArgsOf(ctx, 1)),
  });

// Flag values each command parses, derived from its own `args`.
export type ListTasksValues = ArgValues<ReturnType<typeof createListTasksCommand>['args']>;
export type AddTaskValues = ArgValues<ReturnType<typeof createAddTaskCommand>['args']>;
export type UpdateTaskValues = ArgValues<ReturnType<typeof createUpdateTaskCommand>['args']>;
export type CompleteTaskValues = ArgValues<ReturnType<typeof createCompleteTaskCommand>['args']>;
export type ReopenTaskValues = ArgValues<ReturnType<typeof createReopenTaskCommand>['args']>;
export type DeleteTaskValues = ArgValues<ReturnType<typeof createDeleteTaskCommand>['args']>;

const SUBCOMMANDS = ['list', 'add', 'update', 'complete', 'reopen', 'delete'];

export const createTasksCommand = (context: CliContext) =>
  define({
    name: 'tasks',
    description: 'List, add, update, complete, reopen and delete Google Tasks',
    subCommands: {
      list: createListTasksCommand(context),
      add: createAddTaskCommand(context),
      update: createUpdateTaskCommand(context),
      complete: createCompleteTaskCommand(context),
      reopen: createReopenTaskCommand(context),
      delete: createDeleteTaskCommand(context),
    },
    run: () => reportMissingSubcommand(context.output, 'gct tasks', SUBCOMMANDS),
  });
