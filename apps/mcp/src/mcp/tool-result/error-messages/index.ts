import { GoogleAuthError, GoogleNotFoundError, GooglePermissionError, GoogleRateLimitError } from '@napolab/gct-core/errors';
import { err, ok } from 'neverthrow';

import { GoogleNotConnectedError, GoogleReconnectRequiredError } from '../../../errors';
import { createRunner } from '../../../first-match';

import type { Plugin } from '../../../first-match';
import type { ToolError } from '../index';

// The text an LLM reads after a failed tool call: what went wrong and the one next step that fixes it
// (.claude/rules/mcp-write-strict.md). One plugin per error family (.claude/skills/prefix-match-processor);
// a family without a plugin falls back to its own message (InvalidInputError, task list errors, … already say
// how to fix the input). Messages never contain tokens — core and the token store keep them out.

export type ErrorContext = { readonly error: ToolError; readonly connectURL: string };

type MessagePlugin = Plugin<ErrorContext, string>;

const BOTH_SCOPES = 'sign in with Google and tick BOTH the Google Calendar and the Google Tasks checkboxes';

// A plugin for one error class: the class check lives inside `run`, the message is family-local.
const forClass = <E extends ToolError>(errorClass: abstract new (...args: never[]) => E, describe: (error: E, connectURL: string) => string): MessagePlugin => ({
  run: (input) => (input.error instanceof errorClass ? ok(describe(input.error, input.connectURL)) : err(input)),
});

export const notConnectedPlugin: MessagePlugin = forClass(
  GoogleNotConnectedError,
  (_error, connectURL) => `Google is not connected for this user yet. Ask the user to open ${connectURL} in a browser, ${BOTH_SCOPES}, then call this tool again.`,
);

export const reconnectPlugin: MessagePlugin = forClass(
  GoogleReconnectRequiredError,
  (_error, connectURL) =>
    `The user's Google authorization expired or was revoked, so it was removed. Ask the user to open ${connectURL} in a browser to connect Google again (${BOTH_SCOPES}), then call this tool again.`,
);

export const authPlugin: MessagePlugin = forClass(GoogleAuthError, (error, connectURL) => `${error.message} If this keeps happening, ask the user to reconnect Google at ${connectURL}.`);

export const permissionPlugin: MessagePlugin = forClass(
  GooglePermissionError,
  (error, connectURL) =>
    `${error.message} The calendar / task list may not be shared with this user, or a scope was not granted; in the latter case ask the user to reconnect at ${connectURL} and ${BOTH_SCOPES}.`,
);

export const notFoundPlugin: MessagePlugin = forClass(
  GoogleNotFoundError,
  (error) => `${error.message} Check the id: list_calendars, list_events, list_task_lists and list_tasks return the valid ids.`,
);

export const rateLimitPlugin: MessagePlugin = forClass(GoogleRateLimitError, (error) => `${error.message} Google is rate limiting; wait a moment and retry.`);

// Most specific first: the GoogleAuthError subclasses (not connected / reconnect) before GoogleAuthError itself.
export const ERROR_MESSAGE_PLUGINS: readonly MessagePlugin[] = [notConnectedPlugin, reconnectPlugin, authPlugin, permissionPlugin, notFoundPlugin, rateLimitPlugin];

const describeWith = createRunner(ERROR_MESSAGE_PLUGINS);

export const describeToolError = (error: ToolError, connectURL: string): string => describeWith({ error, connectURL }).unwrapOr(error.message);
