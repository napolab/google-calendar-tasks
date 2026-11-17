import { ALL_SCOPES } from '@napolab/gct-core/scopes';
import { define } from 'gunshi';

import { formatInstant } from '../shared/display-time';
import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { renderWith, report } from '../shared/output';

import type { AuthStatus, CliContext } from '../../context';
import type { ArgValues } from 'gunshi';

// `gct status`: whether a Google login is stored, where, and with which scopes. The auth service never hands
// out the refresh token, so nothing secret can reach the output.

export type Status =
  | { readonly kind: 'logged-out'; readonly credentialPath: string }
  | {
      readonly kind: 'logged-in';
      readonly credentialPath: string;
      readonly scopes: readonly string[];
      // Scopes the CLI needs that the stored login did not grant.
      readonly missingScopes: readonly string[];
      readonly loggedInAt: string;
    };

export const toStatus = (status: AuthStatus): Status => {
  switch (status.kind) {
    case 'logged-out':
      return status;
    case 'logged-in':
      return { ...status, missingScopes: ALL_SCOPES.filter((needed) => !status.scopes.includes(needed)) };
    default: {
      const _exhaustive: never = status;
      throw new Error(`unhandled auth status: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const missingScopesLines = (missing: readonly string[]): readonly string[] =>
  missing.length === 0 ? [] : [`Missing scopes: ${missing.join(', ')}`, 'Run `gct login` again and approve every requested permission.'];

export const formatStatus = (status: Status): string => {
  switch (status.kind) {
    case 'logged-out':
      return ['Not logged in. Run `gct login` to sign in to Google.', `Credentials: ${status.credentialPath} (not found)`].join('\n');
    case 'logged-in':
      return [
        `Logged in (since ${formatInstant(status.loggedInAt)}).`,
        `Credentials: ${status.credentialPath}`,
        `Scopes: ${status.scopes.join(', ')}`,
        ...missingScopesLines(status.missingScopes),
      ].join('\n');
    default: {
      const _exhaustive: never = status;
      throw new Error(`unhandled status: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const runStatus = (ctx: CliContext, values: StatusValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .asyncAndThen(() => ctx.auth.status())
      .map(toStatus),
    renderWith(values.json, formatStatus),
  );

export const createStatusCommand = (context: CliContext) =>
  define({
    name: 'status',
    description: 'Show whether you are logged in, where the credentials are stored and the granted scopes',
    args: {
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    run: (ctx): Promise<void> => runStatus(context, ctx.values, extraArgsOf(ctx, 0)),
  });

// Flag values the command parses, derived from its own `args`.
export type StatusValues = ArgValues<ReturnType<typeof createStatusCommand>['args']>;
