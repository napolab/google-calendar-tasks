import { ALL_SCOPES, GOOGLE_SCOPES } from '@napolab/gct-core/scopes';
import { err, ok } from 'neverthrow';

import { MissingScopesError } from '../errors';

import type { Result } from 'neverthrow';

// Google lets the user untick scopes on the consent screen; the server needs Calendar AND Tasks. The grant may also
// carry unrelated scopes (openid, email, earlier grants via include_granted_scopes), so check containment.
export const requireScopes = (granted: readonly string[], required: readonly string[] = ALL_SCOPES): Result<readonly string[], MissingScopesError> => {
  const missing = required.filter((scope) => !granted.includes(scope));
  return missing.length === 0 ? ok(granted) : err(new MissingScopesError(missing));
};

const LABELS: Readonly<Record<string, string>> = { [GOOGLE_SCOPES.calendar]: 'Google Calendar', [GOOGLE_SCOPES.tasks]: 'Google Tasks' };

// A human label for the status page (fixed text, never derived from request input).
export const describeScope = (scope: string): string => LABELS[scope] ?? scope;
