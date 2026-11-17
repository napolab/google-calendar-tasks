import { describeToolError } from './error-messages';

import type { ToolResource } from './error-messages';

import type { DefaultTaskListNotFoundError } from '../../errors';
import type { AmbiguousTaskListError, GoogleError, InvalidInputError, TaskListNotFoundError } from '@napolab/gct-core/errors';

// Every failure a tool can end with.
export type ToolError = GoogleError | InvalidInputError | TaskListNotFoundError | AmbiguousTaskListError | DefaultTaskListNotFoundError;

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

export const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

export const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

// `resource` names what the module's tools work on, so a 404 points at the list tool that has the valid ids.
export const toToolError =
  (connectURL: string, resource: ToolResource) =>
  (error: ToolError): ToolResult => {
    console.warn('[mcp] tool failed', { error: error.name });
    return fail(describeToolError({ error, connectURL, resource }));
  };
