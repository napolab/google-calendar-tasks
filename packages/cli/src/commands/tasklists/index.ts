import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { jsonArg } from '../shared/flags/json';
import { renderWith, report } from '../shared/output';

import type { CliContext } from '../../context';
import type { TaskListSummary } from '@napolab/gct-core/tasks';
import type { ArgValues } from 'gunshi';

// `gct tasklists`: every Google Tasks list, with the id `gct tasks ... --list` takes.

const formatTaskList = (list: TaskListSummary): string => `${list.title === '' ? '(no title)' : list.title}  [${list.id}]`;

export const formatTaskLists = (lists: readonly TaskListSummary[]): string => (lists.length === 0 ? 'No task lists.' : lists.map(formatTaskList).join('\n'));

const taskListsArgs = { ...jsonArg };

export const runTaskLists = (ctx: CliContext, values: ArgValues<typeof taskListsArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.tasks.listTaskLists())),
    renderWith(values.json, formatTaskLists),
  );

export const createTaskListsCommand = (context: CliContext) =>
  define({
    name: 'tasklists',
    description: 'List your task lists; the bracketed id is what `gct tasks ... --list` takes',
    args: taskListsArgs,
    run: (ctx) => runTaskLists(context, ctx.values, extraArgsOf(ctx, 0)),
  });
