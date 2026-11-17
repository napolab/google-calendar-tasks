import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { prefixed, renderWith, report, reportMissingSubcommand, toJSONText } from '../shared/output';
import { listTasksInAllLists } from './all-lists';
import { formatTaskLine, formatTaskListsTasks, formatTaskPage } from './format';
import { addTaskArgs, listTasksArgs, taskRefArgs, toCreateTaskInput, toListTasksQuery, toTaskRef, toUpdateTaskInput, updateTaskArgs } from './input';
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

type TaskRefValues = ArgValues<typeof taskRefArgs>;

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

export const runListTasks = (ctx: CliContext, values: ArgValues<typeof listTasksArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toListTasksQuery(values))
      .asyncAndThen((query) => ctx.services().andThen((services) => listTasksFor(services.tasks, query))),
    renderListedTasks(values.json),
  );

export const runAddTask = (ctx: CliContext, values: ArgValues<typeof addTaskArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toCreateTaskInput(values.title, values))
      .asyncAndThen((targeted) => ctx.services().andThen((services) => resolveTargeted(services.tasks, targeted).andThen((input) => services.tasks.createTask(input)))),
    renderWith(values.json, prefixed('Added: ', formatTaskLine)),
  );

export const runUpdateTask = (ctx: CliContext, values: ArgValues<typeof updateTaskArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toUpdateTaskInput(values.taskId, values))
      .asyncAndThen((targeted) => ctx.services().andThen((services) => resolveTargeted(services.tasks, targeted).andThen((input) => services.tasks.updateTask(input)))),
    renderWith(values.json, prefixed('Updated: ', formatTaskLine)),
  );

export const runCompleteTask = (ctx: CliContext, values: TaskRefValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() =>
      ctx.services().andThen((services) => resolveTargeted(services.tasks, toTaskRef(values.taskId, values)).andThen((ref) => services.tasks.completeTask(ref))),
    ),
    renderWith(values.json, prefixed('Completed: ', formatTaskLine)),
  );

export const runReopenTask = (ctx: CliContext, values: TaskRefValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => resolveTargeted(services.tasks, toTaskRef(values.taskId, values)).andThen((ref) => services.tasks.reopenTask(ref)))),
    renderWith(values.json, prefixed('Reopened: ', formatTaskLine)),
  );

export const runDeleteTask = (ctx: CliContext, values: TaskRefValues, extra: readonly string[]): Promise<void> =>
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

const SUBCOMMANDS = ['list', 'add', 'update', 'complete', 'reopen', 'delete'];

export const createTasksCommand = (context: CliContext) =>
  define({
    name: 'tasks',
    description: 'List, add, update, complete, reopen and delete Google Tasks',
    subCommands: {
      list: define({
        name: 'list',
        description: 'List tasks grouped by task list (default: every list, completed included, up to 100 per list; --list for one list)',
        args: listTasksArgs,
        toKebab: true,
        run: (ctx) => runListTasks(context, ctx.values, extraArgsOf(ctx, 0)),
      }),
      add: define({
        name: 'add',
        description: 'Add a task',
        args: addTaskArgs,
        toKebab: true,
        run: (ctx) => runAddTask(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
      update: define({
        name: 'update',
        description: 'Change a task: --<field> sets, --clear-<field> removes, absent flags keep the current value',
        args: updateTaskArgs,
        toKebab: true,
        run: (ctx) => runUpdateTask(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
      complete: define({
        name: 'complete',
        description: 'Mark a task completed',
        args: taskRefArgs,
        toKebab: true,
        run: (ctx) => runCompleteTask(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
      reopen: define({
        name: 'reopen',
        description: 'Mark a completed task as not completed',
        args: taskRefArgs,
        toKebab: true,
        run: (ctx) => runReopenTask(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
      delete: define({
        name: 'delete',
        description: 'Delete a task',
        args: taskRefArgs,
        toKebab: true,
        run: (ctx) => runDeleteTask(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
    },
    run: () => reportMissingSubcommand(context.output, 'gct tasks', SUBCOMMANDS),
  });
