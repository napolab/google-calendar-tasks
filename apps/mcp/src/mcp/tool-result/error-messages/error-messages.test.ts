import { GoogleAPIError, GoogleAuthError, GoogleNotFoundError, GooglePermissionError, GoogleRateLimitError, InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { DefaultTaskListNotFoundError, GoogleNotConnectedError, GoogleReconnectRequiredError } from '../../../errors';
import { MCP_TOOL_NAMES } from '../../server';
import type { ToolError } from '../index';

import { ERROR_MESSAGE_PLUGINS, VALID_IDS_FROM, authPlugin, describeToolError, notConnectedPlugin, notFoundPlugin, permissionPlugin, rateLimitPlugin, reconnectPlugin } from './index';

const CONNECT_URL = 'https://gct.example.com/google/connect';

const context = (error: ToolError) => ({ error, connectURL: CONNECT_URL, resource: 'events' as const });

describe('error message plugins (each in isolation)', () => {
  it.each([
    ['not connected', notConnectedPlugin, new GoogleNotConnectedError('x'), CONNECT_URL],
    ['reconnect', reconnectPlugin, new GoogleReconnectRequiredError('x'), 'again'],
    ['auth', authPlugin, new GoogleAuthError('Google API 401'), CONNECT_URL],
    ['permission', permissionPlugin, new GooglePermissionError('Google API 403'), CONNECT_URL],
    ['not found', notFoundPlugin, new GoogleNotFoundError('Google API 404'), 'list_events'],
    ['rate limit', rateLimitPlugin, new GoogleRateLimitError('Google API 429'), 'retry'],
  ] as const)('%s handles its own error class', (_label, plugin, error, hint) => {
    expect(plugin.run(context(error))._unsafeUnwrap()).toContain(hint);
  });

  it.each([notConnectedPlugin, reconnectPlugin, authPlugin, permissionPlugin, notFoundPlugin, rateLimitPlugin])('hands other errors on (%#)', (plugin) => {
    const input = context(new InvalidInputError('bad'));
    expect(plugin.run(input)._unsafeUnwrapErr()).toBe(input);
  });
});

describe('notFoundPlugin hint per resource', () => {
  it.each([
    ['events', ['list_events', 'list_calendars'], ['list_tasks', 'list_settings']],
    ['calendars', ['list_calendars'], ['list_tasks', 'list_events']],
    ['calendarList', ['list_calendars'], ['list_tasks', 'list_events']],
    ['acl', ['list_calendar_acl', 'list_calendars'], ['list_tasks', 'list_events']],
    ['settings', ['list_settings'], ['list_calendars', 'list_tasks', 'list_events']],
    ['tasks', ['list_task_lists', 'list_tasks'], ['list_calendars', 'list_events']],
  ] as const)('%s points at its own list tool only', (resource, expected, unexpected) => {
    const text = notFoundPlugin.run({ error: new GoogleNotFoundError('Google API 404: Not Found'), connectURL: CONNECT_URL, resource })._unsafeUnwrap();
    expect(text).toContain('Google API 404: Not Found');
    for (const tool of expected) expect(text).toContain(tool);
    for (const tool of unexpected) expect(text).not.toContain(tool);
  });
});

// Cross-module sync (.claude/rules/cross-module-sync-test.md): every tool a hint names must be a registered tool.
describe('VALID_IDS_FROM ↔ MCP_TOOL_NAMES', () => {
  it.each(Object.entries(VALID_IDS_FROM))('the %s hint names only registered tools', (_resource, hint) => {
    const named = hint.match(/\blist_[a-z_]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    const registered: readonly string[] = MCP_TOOL_NAMES;
    for (const tool of named) expect(registered).toContain(tool);
  });
});

describe('DefaultTaskListNotFoundError ↔ MCP_TOOL_NAMES', () => {
  it('names only registered tools, and reaches the caller as its own message', () => {
    const error = new DefaultTaskListNotFoundError('日常タスク', ['Work']);
    const named = error.message.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];

    expect(named.length).toBeGreaterThan(0);
    expect(MCP_TOOL_NAMES).toEqual(expect.arrayContaining(named));
    expect(describeToolError({ error, connectURL: CONNECT_URL, resource: 'tasks' })).toBe(error.message);
  });
});

describe('describeToolError (registry order)', () => {
  it('lists the GoogleAuthError subclasses before GoogleAuthError so they are not shadowed', () => {
    const order: readonly unknown[] = ERROR_MESSAGE_PLUGINS;
    expect(order.indexOf(notConnectedPlugin)).toBeLessThan(order.indexOf(authPlugin));
    expect(order.indexOf(reconnectPlugin)).toBeLessThan(order.indexOf(authPlugin));
    expect(describeToolError(context(new GoogleNotConnectedError('x')))).toMatch(/not connected/);
  });

  it('falls back to the error message itself', () => {
    expect(describeToolError(context(new GoogleAPIError('Google API 500: Backend Error', 500)))).toBe('Google API 500: Backend Error');
  });
});
