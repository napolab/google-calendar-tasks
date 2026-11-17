import {
  AmbiguousTaskListError,
  GoogleAPIError,
  GoogleAuthError,
  GoogleNotFoundError,
  GooglePermissionError,
  GoogleRateLimitError,
  InvalidInputError,
  TaskListNotFoundError,
} from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { GoogleNotConnectedError, GoogleReconnectRequiredError } from '../../errors';
import { ok, toToolError } from './index';

const CONNECT_URL = 'https://gct.example.com/google/connect';

const textOf = (result: { content: { text: string }[] }) => result.content.map((block) => block.text).join('\n');

describe('ok', () => {
  it('returns the value as pretty JSON text', () => {
    const result = ok({ id: 'e1' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toEqual({ id: 'e1' });
  });
});

describe('toToolError', () => {
  it('tells the LLM to send the user to the connect page when Google is not connected', () => {
    const result = toToolError(CONNECT_URL)(new GoogleNotConnectedError('not connected'));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(CONNECT_URL);
    expect(textOf(result)).toMatch(/browser/);
  });

  it('asks for a reconnect when the authorization expired', () => {
    const text = textOf(toToolError(CONNECT_URL)(new GoogleReconnectRequiredError('expired')));
    expect(text).toContain(CONNECT_URL);
    expect(text).toMatch(/again/);
  });

  it.each([
    ['another auth failure', new GoogleAuthError('Google API 401: Invalid Credentials'), CONNECT_URL],
    ['a permission failure', new GooglePermissionError('Google API 403: Forbidden'), CONNECT_URL],
    ['a missing resource', new GoogleNotFoundError('Google API 404: Not Found'), 'list_'],
    ['a rate limit', new GoogleRateLimitError('Google API 429: Rate Limit Exceeded'), 'retry'],
  ])('keeps the message of %s and adds the next step', (_label, error, hint) => {
    const text = textOf(toToolError(CONNECT_URL)(error));
    expect(text).toContain(error.message);
    expect(text).toContain(hint);
  });

  it.each([
    new InvalidInputError('due "x" is not a date'),
    new TaskListNotFoundError('Work', ['Home']),
    new AmbiguousTaskListError('Work', [
      { id: 'a', title: 'Work' },
      { id: 'b', title: 'Work' },
    ]),
    new GoogleAPIError('Google API 500: Backend Error', 500),
  ])('passes self-explaining messages through (%s)', (error) => {
    const result = toToolError(CONNECT_URL)(error);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(error.message);
  });
});
