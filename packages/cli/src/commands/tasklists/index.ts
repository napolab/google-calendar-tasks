import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { prefixed, renderWith, report } from '../shared/output';
import { resolveNamedTaskList, resolveTargeted } from '../tasks/task-list';
import { toCreateTaskListInput, toDeleteTaskListName, toRenameTaskListInput } from './input';

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

const LIST_VALUE = "a task list title or id (see 'gct tasklists')";

export const runTaskLists = (ctx: CliContext, values: TaskListsValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.tasks.listTaskLists())),
    renderWith(values.json, formatTaskLists),
  );

export const runAddTaskList = (ctx: CliContext, values: AddTaskListValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toCreateTaskListInput(values.title))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.tasks.createTaskList(input))),
    renderWith(values.json, prefixed('Added: ', formatTaskList)),
  );

export const runRenameTaskList = (ctx: CliContext, values: RenameTaskListValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toRenameTaskListInput(values.list, values.title))
      .asyncAndThen((targeted) => ctx.services().andThen((services) => resolveTargeted(services.tasks, targeted).andThen((input) => services.tasks.renameTaskList(input)))),
    renderWith(values.json, prefixed('Renamed: ', formatTaskList)),
  );

export const runDeleteTaskList = (ctx: CliContext, values: DeleteTaskListValues, extra: readonly string[]): Promise<void> =>
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

export const createListTaskListsCommand = (context: CliContext) =>
  define({
    name: 'list',
    description: LIST_DESCRIPTION,
    args: {
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    run: (ctx): Promise<void> => runTaskLists(context, ctx.values, extraArgsOf(ctx, 0)),
  });

export const createAddTaskListCommand = (context: CliContext) =>
  define({
    name: 'add',
    description: 'Create a task list',
    args: {
      title: { type: 'positional', description: 'Title of the new task list (quote it when it has spaces)' },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    run: (ctx): Promise<void> => runAddTaskList(context, ctx.values, extraArgsOf(ctx, 1)),
  });

export const createRenameTaskListCommand = (context: CliContext) =>
  define({
    name: 'rename',
    description: 'Rename a task list',
    args: {
      list: { type: 'positional', description: `The task list to rename: ${LIST_VALUE}, or @default` },
      title: { type: 'positional', description: 'New title (quote it when it has spaces)' },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    run: (ctx): Promise<void> => runRenameTaskList(context, ctx.values, extraArgsOf(ctx, 2)),
  });

export const createDeleteTaskListCommand = (context: CliContext) =>
  define({
    name: 'delete',
    description: 'Delete a task list and every task in it (cannot be undone; the default list cannot be deleted)',
    args: {
      list: { type: 'positional', description: `The task list to delete with every task in it: ${LIST_VALUE}. The default list cannot be deleted` },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    run: (ctx): Promise<void> => runDeleteTaskList(context, ctx.values, extraArgsOf(ctx, 1)),
  });

// Flag values each command parses, derived from its own `args`. Bare `gct tasklists` takes the same flags as `list`.
export type TaskListsValues = ArgValues<ReturnType<typeof createListTaskListsCommand>['args']>;
export type AddTaskListValues = ArgValues<ReturnType<typeof createAddTaskListCommand>['args']>;
export type RenameTaskListValues = ArgValues<ReturnType<typeof createRenameTaskListCommand>['args']>;
export type DeleteTaskListValues = ArgValues<ReturnType<typeof createDeleteTaskListCommand>['args']>;

// gunshi runs a command's own `run` when no sub-command name follows it, so bare `gct tasklists` keeps listing.
export const createTaskListsCommand = (context: CliContext) =>
  define({
    name: 'tasklists',
    description: `${LIST_DESCRIPTION}; add, rename or delete one with a sub-command`,
    args: {
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    subCommands: {
      list: createListTaskListsCommand(context),
      add: createAddTaskListCommand(context),
      rename: createRenameTaskListCommand(context),
      delete: createDeleteTaskListCommand(context),
    },
    run: (ctx): Promise<void> => runTaskLists(context, ctx.values, extraArgsOf(ctx, 0)),
  });
