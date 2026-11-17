import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { jsonArg } from '../shared/flags/json';
import { prefixed, renderWith, report } from '../shared/output';
import { resolveNamedTaskList, resolveTargeted } from '../tasks/task-list';
import { addTaskListArgs, deleteTaskListArgs, renameTaskListArgs, toCreateTaskListInput, toDeleteTaskListName, toRenameTaskListInput } from './input';

import type { CliContext } from '../../context';
import type { TaskListSummary } from '@napolab/gct-core/tasks';
import type { ArgValues } from 'gunshi';

// `gct tasklists [list|add|rename|delete]`. Bare `gct tasklists` (and `gct tasklists list`) lists every Google
// Tasks list with the title / id `gct tasks ... --list` takes. Handlers only wire: arguments → core input (pure,
// ./input) → context.services() → `<list>` title / id → list (../tasks/task-list) → service call → render.

export type DeletedTaskList = { readonly kind: 'deleted'; readonly taskList: TaskListSummary };

export const formatTaskList = (list: TaskListSummary): string => `${list.title === '' ? '(no title)' : list.title}  [${list.id}]`;

export const formatTaskLists = (lists: readonly TaskListSummary[]): string => (lists.length === 0 ? 'No task lists.' : lists.map(formatTaskList).join('\n'));

const formatDeleted = (deleted: DeletedTaskList): string => `Deleted task list ${formatTaskList(deleted.taskList)}.`;

const taskListsArgs = { ...jsonArg };

export const runTaskLists = (ctx: CliContext, values: ArgValues<typeof taskListsArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.tasks.listTaskLists())),
    renderWith(values.json, formatTaskLists),
  );

export const runAddTaskList = (ctx: CliContext, values: ArgValues<typeof addTaskListArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toCreateTaskListInput(values.title))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.tasks.createTaskList(input))),
    renderWith(values.json, prefixed('Added: ', formatTaskList)),
  );

export const runRenameTaskList = (ctx: CliContext, values: ArgValues<typeof renameTaskListArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toRenameTaskListInput(values.list, values.title))
      .asyncAndThen((targeted) => ctx.services().andThen((services) => resolveTargeted(services.tasks, targeted).andThen((input) => services.tasks.renameTaskList(input)))),
    renderWith(values.json, prefixed('Renamed: ', formatTaskList)),
  );

export const runDeleteTaskList = (ctx: CliContext, values: ArgValues<typeof deleteTaskListArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toDeleteTaskListName(values.list))
      .asyncAndThen((name) =>
        ctx
          .services()
          .andThen((services) =>
            resolveNamedTaskList(services.tasks, name).andThen((taskList) => services.tasks.deleteTaskList({ taskListId: taskList.id }).map((): DeletedTaskList => ({ kind: 'deleted', taskList }))),
          ),
      ),
    renderWith(values.json, formatDeleted),
  );

const LIST_DESCRIPTION = 'List your task lists; `gct tasks ... --list` takes the title or the bracketed id';

export const createTaskListsCommand = (context: CliContext) => {
  // gunshi runs a command's own `run` when no sub-command name follows it, so bare `gct tasklists` keeps listing.
  const list = define({
    name: 'list',
    description: LIST_DESCRIPTION,
    args: taskListsArgs,
    run: (ctx) => runTaskLists(context, ctx.values, extraArgsOf(ctx, 0)),
  });
  return define({
    name: 'tasklists',
    description: `${LIST_DESCRIPTION}; add, rename or delete one with a sub-command`,
    args: taskListsArgs,
    subCommands: {
      list,
      add: define({
        name: 'add',
        description: 'Create a task list',
        args: addTaskListArgs,
        run: (ctx) => runAddTaskList(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
      rename: define({
        name: 'rename',
        description: 'Rename a task list',
        args: renameTaskListArgs,
        run: (ctx) => runRenameTaskList(context, ctx.values, extraArgsOf(ctx, 2)),
      }),
      delete: define({
        name: 'delete',
        description: 'Delete a task list and every task in it (cannot be undone; the default list cannot be deleted)',
        args: deleteTaskListArgs,
        run: (ctx) => runDeleteTaskList(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
    },
    run: (ctx) => runTaskLists(context, ctx.values, extraArgsOf(ctx, 0)),
  });
};
