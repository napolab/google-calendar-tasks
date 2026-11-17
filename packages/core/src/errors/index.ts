// Error channel shared by every core service (.claude/skills/modeling-errors-as-classes).
// Discriminate with instanceof; `name` is a stable wire id for logs / serialized responses.

// Google rejected the credentials (401), or the access token could not be obtained
// (refresh token revoked / expired, token endpoint refused).
export class GoogleAuthError extends Error {
  override name = 'GoogleAuthError' as const;
}

// The token endpoint answered `invalid_grant`: the refresh token (or authorization code) is expired,
// revoked or already used. Retrying cannot help — the user has to authorize again.
// Discriminate with instanceof. `name` stays 'GoogleAuthError' (inherited) so every edge that maps
// GoogleAuthError by name (e.g. the CLI hints) keeps treating it as an auth failure.
export class GoogleInvalidGrantError extends GoogleAuthError {}

// 403: the scope was not granted, the API is disabled in the Cloud project, or the
// caller has no access to the calendar / task list.
export class GooglePermissionError extends Error {
  override name = 'GooglePermissionError' as const;
}

// 404 / 410: the calendar, event, task list or task does not exist (or was deleted).
export class GoogleNotFoundError extends Error {
  override name = 'GoogleNotFoundError' as const;
}

// 429: quota / rate limit exceeded. Retrying later may succeed.
export class GoogleRateLimitError extends Error {
  override name = 'GoogleRateLimitError' as const;
}

// Any other non-2xx answer. `status` keeps the HTTP status for logs.
export class GoogleAPIError extends Error {
  override name = 'GoogleAPIError' as const;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// fetch itself rejected (DNS, connection reset, aborted). The raw error is kept on `cause`.
export class GoogleNetworkError extends Error {
  override name = 'GoogleNetworkError' as const;
}

// Google answered 2xx but the body did not match the expected schema.
export class GoogleResponseParseError extends Error {
  override name = 'GoogleResponseParseError' as const;
}

// Input rejected by core before any request is sent (e.g. end before start, malformed date).
// The message tells the caller how to fix the input (.claude/rules/mcp-write-strict.md).
export class InvalidInputError extends Error {
  override name = 'InvalidInputError' as const;
}

// A task list named by title or id (e.g. a CLI `--list` value or an MCP tool argument).
export type TaskListCandidate = { readonly id: string; readonly title: string };

const quoteTitles = (titles: readonly string[]): string => titles.map((title) => `"${title}"`).join(', ');

const describeLists = (titles: readonly string[]): string => (titles.length === 0 ? 'There are no task lists in this account' : `Available task lists: ${quoteTitles(titles)}`);

// No task list has this id or title. Lists every title so the caller can retry with one.
export class TaskListNotFoundError extends Error {
  override name = 'TaskListNotFoundError' as const;
  readonly query: string;
  readonly titles: readonly string[];

  constructor(query: string, titles: readonly string[]) {
    super(`No task list has the id or title "${query}". ${describeLists(titles)}. Pass one of these titles, a task list id, or "@default" for the default list.`);
    this.query = query;
    this.titles = titles;
  }
}

// Several task lists share this title. Lists them with their ids so the caller can pass an id instead.
export class AmbiguousTaskListError extends Error {
  override name = 'AmbiguousTaskListError' as const;
  readonly query: string;
  readonly candidates: readonly TaskListCandidate[];

  constructor(query: string, candidates: readonly TaskListCandidate[]) {
    const listed = candidates.map((candidate) => `"${candidate.title}" (id ${candidate.id})`).join(', ');
    super(`Task list "${query}" is ambiguous: ${candidates.length} lists have that title: ${listed}. Pass the id of the one you mean instead of the title.`);
    this.query = query;
    this.candidates = candidates;
  }
}

export type GoogleError = GoogleAuthError | GooglePermissionError | GoogleNotFoundError | GoogleRateLimitError | GoogleAPIError | GoogleNetworkError | GoogleResponseParseError;
