import { ResultAsync, errAsync, okAsync } from 'neverthrow';

import { GoogleAPIError, GoogleAuthError, GoogleNetworkError, GoogleNotFoundError, GooglePermissionError, GoogleRateLimitError, GoogleResponseParseError } from '../errors';

import type { GoogleError } from '../errors';
import type { z } from 'zod';

// `string | URL | Request` (not DOM-only `RequestInfo`) so Node-lib consumers such as the CLI typecheck too.
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// Supplies a valid OAuth access token. Where it comes from (refresh-token grant, a token
// forwarded by an upstream proxy, ...) is the runtime's concern — core only consumes it.
export type GetAccessToken = () => ResultAsync<string, GoogleAuthError>;

export type GoogleClientDeps = {
  readonly fetch: Fetch;
  readonly getAccessToken: GetAccessToken;
};

export type QueryValue = string | number | boolean | undefined;

export type GoogleRequest<S extends z.ZodType> = {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly schema: S;
};

export interface GoogleClient {
  request<S extends z.ZodType>(req: GoogleRequest<S>): ResultAsync<z.output<S>, GoogleError>;
}

const buildURL = (url: string, query: Readonly<Record<string, QueryValue>> | undefined): string => {
  const target = new URL(url);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    target.searchParams.set(key, `${value}`);
  }
  return target.toString();
};

const buildInit = <S extends z.ZodType>(req: GoogleRequest<S>, token: string): RequestInit => {
  const headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json' });
  if (req.body === undefined) return { method: req.method, headers };

  headers.set('content-type', 'application/json');
  return { method: req.method, headers, body: JSON.stringify(req.body) };
};

// Google error bodies look like `{ error: { code, message, errors: [...] } }`.
const readErrorMessage = (response: Response): Promise<string> =>
  response
    .json()
    .then((body: unknown) => {
      if (typeof body !== 'object' || body === null || !('error' in body)) return response.statusText;
      const { error } = body;
      if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message;
      return response.statusText;
    })
    .catch(() => response.statusText);

const toHTTPError = (status: number, message: string): GoogleError => {
  const text = `Google API ${status}: ${message}`;
  switch (status) {
    case 401:
      return new GoogleAuthError(text);
    case 403:
      return new GooglePermissionError(text);
    case 404:
    case 410:
      return new GoogleNotFoundError(text);
    case 429:
      return new GoogleRateLimitError(text);
    default:
      return new GoogleAPIError(text, status);
  }
};

const readBody = (response: Response): ResultAsync<unknown, GoogleResponseParseError> => {
  if (response.status === 204) return okAsync(undefined);
  return ResultAsync.fromPromise(response.text(), (cause) => new GoogleResponseParseError('Failed to read the Google API response body', { cause })).andThen((text) => {
    if (text === '') return okAsync(undefined);
    return ResultAsync.fromPromise(
      Promise.resolve().then((): unknown => JSON.parse(text)),
      (cause) => new GoogleResponseParseError('Google API response is not JSON', { cause }),
    );
  });
};

const parseWith =
  <S extends z.ZodType>(schema: S) =>
  (body: unknown): ResultAsync<z.output<S>, GoogleResponseParseError> => {
    const parsed = schema.safeParse(body);
    if (parsed.success) return okAsync(parsed.data);
    return errAsync(new GoogleResponseParseError(`Unexpected Google API response shape: ${parsed.error.message}`, { cause: parsed.error }));
  };

const handleResponse =
  <S extends z.ZodType>(schema: S) =>
  (response: Response): ResultAsync<z.output<S>, GoogleError> => {
    if (!response.ok) return ResultAsync.fromSafePromise(readErrorMessage(response)).andThen((message) => errAsync(toHTTPError(response.status, message)));
    return readBody(response).andThen(parseWith(schema));
  };

export const createGoogleClient = (deps: GoogleClientDeps): GoogleClient => ({
  request: (req) =>
    deps
      .getAccessToken()
      .andThen((token) => ResultAsync.fromPromise(deps.fetch(buildURL(req.url, req.query), buildInit(req, token)), (cause) => new GoogleNetworkError('Request to the Google API failed', { cause })))
      .andThen(handleResponse(req.schema)),
});
