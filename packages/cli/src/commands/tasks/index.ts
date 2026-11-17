import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { prefixed, renderWith, report, reportMissingSubcommand } from '../shared/output';
import { formatTaskLine, formatTaskPage } from './format';
import { addTaskArgs, listTasksArgs, taskRefArgs, toCreateTaskInput, toListTasksInput, toTaskRef, toUpdateTaskInput, updateTaskArgs } from './input';

import type { CliContext } from '../../context';
import type { TaskRef } from '@napolab/gct-core/tasks';
import type { ArgValues } from 'gunshi';

// `gct tasks list|add|update|complete|reopen|delete`. Handlers only wire: flags → core input (pure, ./input) →
// context.services() → service call → render (./format). Input is validated before any Google call.

const DEFAULT_TASK_LIST = '@default';

export type DeletedTask = { readonly kind: 'deleted'; readonly taskListId: string; readonly taskId: string };

const toDeleted = (ref: TaskRef): DeletedTask => ({ kind: 'deleted', taskListId: ref.taskListId ?? DEFAULT_TASK_LIST, taskId: ref.taskId });

const formatDeleted = (deleted: DeletedTask): string => `Deleted task ${deleted.taskId} from list ${deleted.taskListId}.`;

type TaskRefValues = ArgValues<typeof taskRefArgs>;

export const runListTasks = (ctx: CliContext, values: ArgValues<typeof listTasksArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toListTasksInput(values))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.tasks.listTasks(input))),
    renderWith(values.json, formatTaskPage),
  );

export const runAddTask = (ctx: CliContext, values: ArgValues<typeof addTaskArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toCreateTaskInput(values.title, values))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.tasks.createTask(input))),
    renderWith(values.json, prefixed('Added: ', formatTaskLine)),
  );

export const runUpdateTask = (ctx: CliContext, values: ArgValues<typeof updateTaskArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toUpdateTaskInput(values.taskId, values))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.tasks.updateTask(input))),
    renderWith(values.json, prefixed('Updated: ', formatTaskLine)),
  );

export const runCompleteTask = (ctx: CliContext, values: TaskRefValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.tasks.completeTask(toTaskRef(values.taskId, values)))),
    renderWith(values.json, prefixed('Completed: ', formatTaskLine)),
  );

export const runReopenTask = (ctx: CliContext, values: TaskRefValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.tasks.reopenTask(toTaskRef(values.taskId, values)))),
    renderWith(values.json, prefixed('Reopened: ', formatTaskLine)),
  );

export const runDeleteTask = (ctx: CliContext, values: TaskRefValues, extra: readonly string[]): Promise<void> => {
  const ref = toTaskRef(values.taskId, values);
  return report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.tasks.deleteTask(ref).map(() => toDeleted(ref)))),
    renderWith(values.json, formatDeleted),
  );
};

const SUBCOMMANDS = ['list', 'add', 'update', 'complete', 'reopen', 'delete'];

export const createTasksCommand = (context: CliContext) =>
  define({
    name: 'tasks',
    description: 'List, add, update, complete, reopen and delete Google Tasks',
    subCommands: {
      list: define({
        name: 'list',
        description: 'List tasks of a list (default: your default list, completed included, 100 per page)',
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
