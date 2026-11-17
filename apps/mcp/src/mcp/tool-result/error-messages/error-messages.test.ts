import { GoogleAPIError, GoogleAuthError, GoogleNotFoundError, GooglePermissionError, GoogleRateLimitError, InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { GoogleNotConnectedError, GoogleReconnectRequiredError } from '../../../errors';
import type { ToolError } from '../index';

import { ERROR_MESSAGE_PLUGINS, authPlugin, describeToolError, notConnectedPlugin, notFoundPlugin, permissionPlugin, rateLimitPlugin, reconnectPlugin } from './index';

const CONNECT_URL = 'https://gct.example.com/google/connect';

const context = (error: ToolError) => ({ error, connectURL: CONNECT_URL });

describe('error message plugins (each in isolation)', () => {
  it.each([
    ['not connected', notConnectedPlugin, new GoogleNotConnectedError('x'), CONNECT_URL],
    ['reconnect', reconnectPlugin, new GoogleReconnectRequiredError('x'), 'again'],
    ['auth', authPlugin, new GoogleAuthError('Google API 401'), CONNECT_URL],
    ['permission', permissionPlugin, new GooglePermissionError('Google API 403'), CONNECT_URL],
    ['not found', notFoundPlugin, new GoogleNotFoundError('Google API 404'), 'list_events'],
    ['rate limit', rateLimitPlugin, new GoogleRateLimitError('Google API 429'), 'retry'],
  ] as const)('%s handles its own error class', (_label, plugin, error, hint) => {
    expect(plugin.run({ error, connectURL: CONNECT_URL })._unsafeUnwrap()).toContain(hint);
  });

  it.each([notConnectedPlugin, reconnectPlugin, authPlugin, permissionPlugin, notFoundPlugin, rateLimitPlugin])('hands other errors on (%#)', (plugin) => {
    const input = context(new InvalidInputError('bad'));
    expect(plugin.run(input)._unsafeUnwrapErr()).toBe(input);
  });
});

describe('describeToolError (registry order)', () => {
  it('lists the GoogleAuthError subclasses before GoogleAuthError so they are not shadowed', () => {
    const order: readonly unknown[] = ERROR_MESSAGE_PLUGINS;
    expect(order.indexOf(notConnectedPlugin)).toBeLessThan(order.indexOf(authPlugin));
    expect(order.indexOf(reconnectPlugin)).toBeLessThan(order.indexOf(authPlugin));
    expect(describeToolError(new GoogleNotConnectedError('x'), CONNECT_URL)).toMatch(/not connected/);
  });

  it('falls back to the error message itself', () => {
    expect(describeToolError(new GoogleAPIError('Google API 500: Backend Error', 500), CONNECT_URL)).toBe('Google API 500: Backend Error');
  });
});
