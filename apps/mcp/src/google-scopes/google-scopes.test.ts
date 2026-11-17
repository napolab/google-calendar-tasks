import { ALL_SCOPES, GOOGLE_SCOPES } from '@napolab/gct-core/scopes';
import { describe, expect, it } from 'vitest';

import { MissingScopesError } from '../errors';
import { describeScope, requireScopes } from './index';

describe('requireScopes', () => {
  it('accepts a grant that contains every required scope, extra scopes included', () => {
    const granted = ['openid', 'email', ...ALL_SCOPES];
    expect(requireScopes(granted)._unsafeUnwrap()).toEqual(granted);
  });

  it('names the scopes that were not granted', () => {
    const error = requireScopes(['openid', GOOGLE_SCOPES.calendar])._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(MissingScopesError);
    expect(error.missing).toEqual([GOOGLE_SCOPES.tasks]);
  });
});

describe('describeScope', () => {
  it('labels the scopes this server uses and passes others through', () => {
    expect(describeScope(GOOGLE_SCOPES.calendar)).toBe('Google Calendar');
    expect(describeScope(GOOGLE_SCOPES.tasks)).toBe('Google Tasks');
    expect(describeScope('openid')).toBe('openid');
  });
});
