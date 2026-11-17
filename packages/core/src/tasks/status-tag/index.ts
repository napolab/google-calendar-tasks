// The board status of a task, kept in its notes (Google Tasks itself only knows needsAction / completed).
//
// Template: the FIRST line of `notes` may be a tag `[status: todo]` / `[status: doing]` / `[status: done]`; everything
// after that first line break is the body. The tag is read leniently (surrounding whitespace, any case) and always
// written canonically (`[status: <value>]`). A first line shaped like a tag with any other value is still the tag line
// (`unknown`): it is not part of the body, and writing a status replaces it.
//
// Column: a completed task is `done` whatever its tag says (Google's completion is authoritative). An open task is
// `doing` when tagged doing, otherwise `todo` (todo tag, no tag, unknown tag, or a stale `done` tag left by a reopen in
// Google's own app).
//
// Pure functions only: used by the MCP tools (which hand the board UI the derived boardStatus / body) and the CLI.

export const TASK_BOARD_STATUSES = ['todo', 'doing', 'done'] as const;

export type TaskBoardStatus = (typeof TASK_BOARD_STATUSES)[number];

export type ParsedStatusTag =
  | { readonly kind: 'none'; readonly body: string }
  | { readonly kind: 'tagged'; readonly status: TaskBoardStatus; readonly body: string }
  // A tag line with a value outside TASK_BOARD_STATUSES (`value` as written, trimmed).
  | { readonly kind: 'unknown'; readonly value: string; readonly body: string };

// The task fields the column depends on (structural, so wire views and core tasks both fit).
export type StatusTaggedTask = { readonly status: 'needsAction' | 'completed'; readonly notes: string };

const TAG_LINE = /^\s*\[\s*status\s*:\s*([^\]]*?)\s*\]\s*$/i;

// The first line (without a trailing CR) and everything after its line break ('' when there is no line break).
const splitFirstLine = (notes: string): { readonly first: string; readonly rest: { readonly kind: 'none' } | { readonly kind: 'some'; readonly text: string } } => {
  const newline = notes.indexOf('\n');
  if (newline === -1) return { first: notes, rest: { kind: 'none' } };
  return { first: notes.slice(0, newline).replace(/\r$/, ''), rest: { kind: 'some', text: notes.slice(newline + 1) } };
};

const bodyAfter = (rest: { readonly kind: 'none' } | { readonly kind: 'some'; readonly text: string }): string => {
  switch (rest.kind) {
    case 'none':
      return '';
    case 'some':
      return rest.text;
    default: {
      const _exhaustive: never = rest;
      throw new Error(`unhandled rest: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const isBoardStatus = (value: string): value is TaskBoardStatus => TASK_BOARD_STATUSES.some((status) => status === value);

export const parseStatusTag = (notes: string): ParsedStatusTag => {
  const { first, rest } = splitFirstLine(notes);
  const match = TAG_LINE.exec(first);
  if (match === null) return { kind: 'none', body: notes };
  const value = match[1] ?? '';
  const normalized = value.toLowerCase();
  const body = bodyAfter(rest);
  return isBoardStatus(normalized) ? { kind: 'tagged', status: normalized, body } : { kind: 'unknown', value, body };
};

const canonicalTag = (status: TaskBoardStatus): string => `[status: ${status}]`;

// Inserts or replaces the first-line tag. Everything after the first line break is kept byte for byte (CRLF included),
// so writing is idempotent and never adds or drops a trailing newline.
export const writeStatusTag = (notes: string, status: TaskBoardStatus): string => {
  const parsed = parseStatusTag(notes);
  switch (parsed.kind) {
    case 'none':
      return notes === '' ? canonicalTag(status) : `${canonicalTag(status)}\n${notes}`;
    case 'tagged':
    case 'unknown': {
      const newline = notes.indexOf('\n');
      if (newline === -1) return canonicalTag(status);
      // Keep the tag line's own line ending (LF or CRLF) along with the body.
      const lineEnd = notes[newline - 1] === '\r' ? newline - 1 : newline;
      return `${canonicalTag(status)}${notes.slice(lineEnd)}`;
    }
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`unhandled tag: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const openTaskStatus = (parsed: ParsedStatusTag): TaskBoardStatus => {
  switch (parsed.kind) {
    case 'tagged':
      return parsed.status === 'doing' ? 'doing' : 'todo';
    case 'none':
    case 'unknown':
      return 'todo';
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`unhandled tag: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const boardStatusOf = (task: StatusTaggedTask): TaskBoardStatus => {
  switch (task.status) {
    case 'completed':
      return 'done';
    case 'needsAction':
      return openTaskStatus(parseStatusTag(task.notes));
    default: {
      const _exhaustive: never = task.status;
      throw new Error(`unhandled task status: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
