import { z } from 'zod';

// The board's boundary: tool results from the host bridge (CallToolResult, untyped at runtime) parsed into the board's
// own data. The wire's nulls become named variants here; fields the board does not show are dropped.

export type BoardStatus = 'todo' | 'doing' | 'done';

export type TaskItem = {
  readonly id: string;
  readonly taskListId: string;
  readonly title: string;
  // Notes without the status tag line.
  readonly body: string;
  readonly boardStatus: BoardStatus;
  readonly unknownStatusTag: { readonly kind: 'none' } | { readonly kind: 'unknown'; readonly value: string };
  readonly due: { readonly kind: 'none' } | { readonly kind: 'date'; readonly date: string };
  readonly parent: { readonly kind: 'root' } | { readonly kind: 'subtask'; readonly parentId: string };
};

// A task in list_tasks' outline order: depth 0 = top level (or a subtask whose parent is not in the page).
export type ListedTaskItem = TaskItem & { readonly depth: number };

export type TaskListPage = {
  readonly taskListId: string;
  readonly title: string;
  readonly tasks: readonly ListedTaskItem[];
  // More tasks exist than the first page (100) the board shows.
  readonly truncated: boolean;
};

export type BoardSelection = { readonly kind: 'all' } | { readonly kind: 'list'; readonly taskListId: string };

export type BoardPayload = { readonly lists: readonly TaskListPage[]; readonly selection: BoardSelection };

export type Parsed<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'error'; readonly message: string };

const UNREADABLE = 'サーバーの応答を読み取れませんでした。「更新」を押してください。';

const taskShape = {
  id: z.string(),
  taskListId: z.string(),
  title: z.string(),
  body: z.string(),
  boardStatus: z.enum(['todo', 'doing', 'done']),
  unknownStatusTag: z.string().nullable(),
  due: z.string().nullable(),
  parentId: z.string().nullable(),
};

type WireTask = z.output<z.ZodObject<typeof taskShape>>;

const toTaskItem = (task: WireTask): TaskItem => ({
  id: task.id,
  taskListId: task.taskListId,
  title: task.title,
  body: task.body,
  boardStatus: task.boardStatus,
  unknownStatusTag: task.unknownStatusTag === null ? { kind: 'none' } : { kind: 'unknown', value: task.unknownStatusTag },
  due: task.due === null ? { kind: 'none' } : { kind: 'date', date: task.due },
  parent: task.parentId === null ? { kind: 'root' } : { kind: 'subtask', parentId: task.parentId },
});

const taskSchema = z.object(taskShape).transform(toTaskItem);

const listedTaskSchema = z.object({ ...taskShape, depth: z.number().int().min(0) }).transform((task): ListedTaskItem => ({ ...toTaskItem(task), depth: task.depth }));

const listPageSchema = z
  .object({ taskListId: z.string(), title: z.string(), tasks: z.array(listedTaskSchema), nextPageToken: z.string().nullable() })
  .transform((page): TaskListPage => ({ taskListId: page.taskListId, title: page.title, tasks: page.tasks, truncated: page.nextPageToken !== null }));

const listingSchema = z.object({ lists: z.array(listPageSchema) });

const selectionSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('all') }), z.object({ kind: z.literal('list'), taskListId: z.string() })]);

const boardPayloadSchema = z.object({ lists: z.array(listPageSchema), selection: selectionSchema });

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  structuredContent: z.unknown().optional(),
});

type ToolResultShape = z.output<typeof toolResultSchema>;

const textOf = (result: ToolResultShape): string => result.content?.find((block) => block.type === 'text')?.text ?? '';

const parseJSON = (text: string): Parsed<unknown> => {
  try {
    return { kind: 'ok', value: JSON.parse(text) };
  } catch {
    return { kind: 'error', message: UNREADABLE };
  }
};

const parseWith = <T>(schema: z.ZodType<T>, value: unknown): Parsed<T> => {
  const parsed = schema.safeParse(value);
  return parsed.success ? { kind: 'ok', value: parsed.data } : { kind: 'error', message: UNREADABLE };
};

// structuredContent when the tool sends it (show_task_board), else the JSON text every tool sends.
const payloadOf = (result: ToolResultShape): Parsed<unknown> => (result.structuredContent === undefined ? parseJSON(textOf(result)) : { kind: 'ok', value: result.structuredContent });

const parseToolResult = <T>(schema: z.ZodType<T>, raw: unknown): Parsed<T> => {
  const result = toolResultSchema.safeParse(raw);
  if (!result.success) return { kind: 'error', message: UNREADABLE };
  if (result.data.isError === true) return { kind: 'error', message: textOf(result.data) };
  const payload = payloadOf(result.data);
  switch (payload.kind) {
    case 'ok':
      return parseWith(schema, payload.value);
    case 'error':
      return payload;
    default: {
      const _exhaustive: never = payload;
      throw new Error(`unhandled payload: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const parseListing = (raw: unknown): Parsed<readonly TaskListPage[]> => {
  const parsed = parseToolResult(listingSchema, raw);
  return parsed.kind === 'ok' ? { kind: 'ok', value: parsed.value.lists } : parsed;
};

export const parseBoardPayload = (raw: unknown): Parsed<BoardPayload> => parseToolResult(boardPayloadSchema, raw);

export const parseTask = (raw: unknown): Parsed<TaskItem> => parseToolResult(taskSchema, raw);
