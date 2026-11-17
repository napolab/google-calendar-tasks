import { define } from 'gunshi';
import { ResultAsync } from 'neverthrow';

import { formatInstant } from '../shared/display-time';
import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { renderWith, report } from '../shared/output';

import type { CliContext, LoginError, LoginSession, LoginSummary } from '../../context';
import type { ArgValues } from 'gunshi';
import type { Result } from 'neverthrow';

// `gct login`: the entrypoint of one login (.claude/rules/entrypoint-lifetime.md). It owns the login session —
// and with it the OAuth loopback server — via `await using`, and the deadline via `AbortSignal.timeout`.
// Progress (the consent URL) goes to stderr; stdout carries only the result, which never holds a token.

const LOGIN_TIMEOUT_MS = 5 * 60_000;

export const formatLogin = (summary: LoginSummary): string =>
  [`Logged in to Google (${formatInstant(summary.loggedInAt)}).`, `Scopes: ${summary.scopes.join(', ')}`, `Credentials saved to ${summary.credentialPath}`].join('\n');

// The session is disposed (the loopback server closed) when this returns, whether the login succeeded or not.
const completeLogin = async (session: LoginSession): Promise<Result<LoginSummary, LoginError>> => {
  await using owned = session;
  return await owned.complete();
};

export const runLogin = (ctx: CliContext, values: LoginValues, extra: readonly string[]): Promise<void> => {
  const signal = AbortSignal.timeout(LOGIN_TIMEOUT_MS);
  return report(
    ctx.output,
    rejectExtraArgs(extra)
      .asyncAndThen(() => ctx.auth.startLogin({ signal, print: ctx.output.err }))
      .andThen((session) => new ResultAsync(completeLogin(session))),
    renderWith(values.json, formatLogin),
  );
};

export const createLoginCommand = (context: CliContext) =>
  define({
    name: 'login',
    description: 'Log in to Google in your browser and store the refresh token locally',
    args: {
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    run: (ctx): Promise<void> => runLogin(context, ctx.values, extraArgsOf(ctx, 0)),
  });

// Flag values the command parses, derived from its own `args`.
export type LoginValues = ArgValues<ReturnType<typeof createLoginCommand>['args']>;
