// Error channel shared by every core service (.claude/skills/modeling-errors-as-classes).
// Discriminate with instanceof; `name` is a stable wire id for logs / serialized responses.

// Google rejected the credentials (401), or the access token could not be obtained
// (refresh token revoked / expired, token endpoint refused).
export class GoogleAuthError extends Error {
  override name = 'GoogleAuthError' as const;
}

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

export type GoogleError = GoogleAuthError | GooglePermissionError | GoogleNotFoundError | GoogleRateLimitError | GoogleAPIError | GoogleNetworkError | GoogleResponseParseError;
