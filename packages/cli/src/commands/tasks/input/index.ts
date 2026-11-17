import { InvalidInputError } from '@napolab/gct-core/errors';
import { err, ok } from 'neverthrow';

import { parseDate } from '../../shared/flags/date';
import { jsonArg } from '../../shared/flags/json';
import { toKeepOrSet, toTextPatch } from '../../shared/flags/patch';

import type { CompletedTasksFilter, CreateTaskInput, FieldPatch, ListTasksInput, TaskDueFilter, TaskPlacement, TaskRef, TaskSiblingPosition, UpdateTaskInput } from '@napolab/gct-core/tasks';
import type { ArgValues, Args } from 'gunshi';
import type { Result } from 'neverthrow';

// `gct tasks ...` flags and their mapping to core tasks inputs. Pure. CLI defaults (include completed tasks,
// 100 per page) live here because core inputs are required unions.

const COMPLETED_CHOICES = ['exclude', 'include', 'hidden'] as const;

type CompletedChoice = (typeof COMPLETED_CHOICES)[number];

// ---- flag schemas ----

const listArg = {
  list: { type: 'string', description: "Task list id (default: your default list; see 'gct tasklists')" },
} satisfies Args;

const taskIdArg = {
  taskId: { type: 'positional', description: 'Task id (shown in brackets by `gct tasks list`)' },
} satisfies Args;

export const listTasksArgs = {
  ...listArg,
  dueFrom: { type: 'string', description: 'Only tasks due on or after this date (YYYY-MM-DD)' },
  dueTo: { type: 'string', description: 'Only tasks due on or before this date (YYYY-MM-DD)' },
  completed: {
    type: 'enum',
    choices: COMPLETED_CHOICES,
    default: 'include',
    description: 'Completed tasks: exclude, include, or hidden (also those completed in Google apps, which Google hides)',
  },
  max: { type: 'number', default: 100, description: 'Tasks per page (1-100)' },
  pageToken: { type: 'string', description: 'Page token printed by the previous page' },
  ...jsonArg,
} satisfies Args;

export const addTaskArgs = {
  title: { type: 'positional', description: 'Task title (quote it when it has spaces)' },
  notes: { type: 'string', description: 'Task notes' },
  due: { type: 'string', description: 'Due date (YYYY-MM-DD; Google Tasks has no due time)' },
  parent: { type: 'string', description: 'Create as a subtask of this task id' },
  after: { type: 'string', description: 'Place after this sibling task id (default: first)' },
  ...listArg,
  ...jsonArg,
} satisfies Args;

export const updateTaskArgs = {
  ...taskIdArg,
  title: { type: 'string', description: 'New title' },
  notes: { type: 'string', description: 'New notes' },
  clearNotes: { type: 'boolean', description: 'Remove the notes' },
  due: { type: 'string', description: 'New due date (YYYY-MM-DD)' },
  clearDue: { type: 'boolean', description: 'Remove the due date' },
  ...listArg,
  ...jsonArg,
} satisfies Args;

export const taskRefArgs = { ...taskIdArg, ...listArg, ...jsonArg } satisfies Args;

type Flags<A extends Args> = Omit<ArgValues<A>, 'taskId' | 'title' | 'json'>;

export type ListTasksFlags = Flags<typeof listTasksArgs>;
export type AddTaskFlags = Flags<typeof addTaskArgs>;
export type UpdateTaskFlags = Omit<ArgValues<typeof updateTaskArgs>, 'taskId' | 'json'>;
export type TaskRefFlags = Flags<typeof taskRefArgs>;

// ---- shared ----

// `taskListId` is the one optional core input; it is omitted (→ '@default') unless --list is given.
const listOf = (list: string | undefined): { readonly taskListId?: string } => (list === undefined ? {} : { taskListId: list });

const parseOptionalDate = (flag: string, value: string | undefined): Result<string | undefined, InvalidInputError> => (value === undefined ? ok(undefined) : parseDate(flag, value));

export const toTaskRef = (taskId: string, flags: TaskRefFlags): TaskRef => ({ ...listOf(flags.list), taskId });

// ---- list ----

const COMPLETED_FILTER = { exclude: 'exclude', include: 'include', hidden: 'includeHidden' } satisfies Record<CompletedChoice, CompletedTasksFilter>;

const toDueFilter = (dueMin: string | undefined, dueMax: string | undefined): TaskDueFilter => {
  if (dueMin === undefined) return dueMax === undefined ? { kind: 'any' } : { kind: 'until', dueMax };
  return dueMax === undefined ? { kind: 'from', dueMin } : { kind: 'between', dueMin, dueMax };
};

export const toListTasksInput = (flags: ListTasksFlags): Result<ListTasksInput, InvalidInputError> =>
  parseOptionalDate('--due-from', flags.dueFrom).andThen((dueMin) =>
    parseOptionalDate('--due-to', flags.dueTo).map((dueMax): ListTasksInput => ({
      ...listOf(flags.list),
      due: toDueFilter(dueMin, dueMax),
      completed: COMPLETED_FILTER[flags.completed],
      page: flags.pageToken === undefined ? { kind: 'first' } : { kind: 'token', pageToken: flags.pageToken },
      maxResults: flags.max,
    })),
  );

// ---- add ----

const toSiblingPosition = (after: string | undefined): TaskSiblingPosition => (after === undefined ? { kind: 'first' } : { kind: 'after', previousId: after });

const toPlacement = (flags: AddTaskFlags): TaskPlacement => {
  const position = toSiblingPosition(flags.after);
  return flags.parent === undefined ? { kind: 'root', position } : { kind: 'subtask', parentId: flags.parent, position };
};

export const toCreateTaskInput = (title: string, flags: AddTaskFlags): Result<CreateTaskInput, InvalidInputError> =>
  parseOptionalDate('--due', flags.due).map((due): CreateTaskInput => ({
    ...listOf(flags.list),
    title,
    notes: flags.notes ?? '',
    due: due === undefined ? { kind: 'none' } : { kind: 'date', date: due },
    placement: toPlacement(flags),
  }));

// ---- update ----

// `--due` is checked as a date only when it sets one.
const validateDuePatch = (patch: FieldPatch<string>): Result<FieldPatch<string>, InvalidInputError> => {
  switch (patch.kind) {
    case 'keep':
    case 'clear':
      return ok(patch);
    case 'set':
      return parseDate('--due', patch.value).map((value) => ({ kind: 'set', value }));
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const requireChange = (input: UpdateTaskInput): Result<UpdateTaskInput, InvalidInputError> => {
  if ([input.title, input.notes, input.due].some((patch) => patch.kind !== 'keep')) return ok(input);
  return err(
    new InvalidInputError(
      `Nothing to update for task "${input.taskId}". Pass at least one of --title, --notes / --clear-notes, --due YYYY-MM-DD / --clear-due. To change the status use \`gct tasks complete\` or \`gct tasks reopen\`.`,
    ),
  );
};

export const toUpdateTaskInput = (taskId: string, flags: UpdateTaskFlags): Result<UpdateTaskInput, InvalidInputError> =>
  toKeepOrSet('title', flags.title).andThen((title) =>
    toTextPatch('notes', flags.notes, flags.clearNotes).andThen((notes) =>
      toTextPatch('due', flags.due, flags.clearDue)
        .andThen(validateDuePatch)
        .map((due): UpdateTaskInput => ({ ...listOf(flags.list), taskId, title, notes, due }))
        .andThen(requireChange),
    ),
  );
