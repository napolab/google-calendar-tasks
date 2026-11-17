import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { renderWith, report } from '../shared/output';

import type { CliContext, LogoutOutcome, Revocation } from '../../context';
import type { ArgValues } from 'gunshi';

// `gct logout`: revoke the stored refresh token at Google (best-effort) and delete it locally.

export type RevocationReport = { readonly kind: 'revoked' } | { readonly kind: 'revoke-failed'; readonly reason: string };

export type LogoutReport =
  | { readonly kind: 'not-logged-in'; readonly credentialPath: string }
  | { readonly kind: 'logged-out'; readonly credentialPath: string; readonly revocation: RevocationReport };

const toRevocationReport = (revocation: Revocation): RevocationReport => {
  switch (revocation.kind) {
    case 'revoked':
      return revocation;
    case 'revoke-failed':
      return { kind: 'revoke-failed', reason: `${revocation.error.name}: ${revocation.error.message}` };
    default: {
      const _exhaustive: never = revocation;
      throw new Error(`unhandled revocation: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Errors do not serialize to JSON, so the revocation failure is carried as text.
export const toLogoutReport = (outcome: LogoutOutcome, credentialPath: string): LogoutReport => {
  switch (outcome.kind) {
    case 'not-logged-in':
      return { kind: 'not-logged-in', credentialPath };
    case 'logged-out':
      return { kind: 'logged-out', credentialPath, revocation: toRevocationReport(outcome.revocation) };
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`unhandled logout outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const formatRevocation = (revocation: RevocationReport): string => {
  switch (revocation.kind) {
    case 'revoked':
      return 'The refresh token was revoked at Google.';
    case 'revoke-failed':
      return `Revoking the refresh token at Google failed (${revocation.reason}); it was deleted locally. You can also remove access at https://myaccount.google.com/permissions.`;
    default: {
      const _exhaustive: never = revocation;
      throw new Error(`unhandled revocation: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const formatLogout = (report: LogoutReport): string => {
  switch (report.kind) {
    case 'not-logged-in':
      return `Not logged in; nothing to do (${report.credentialPath} does not exist).`;
    case 'logged-out':
      return [`Logged out. Deleted ${report.credentialPath}.`, formatRevocation(report.revocation)].join('\n');
    default: {
      const _exhaustive: never = report;
      throw new Error(`unhandled logout report: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const runLogout = (ctx: CliContext, values: LogoutValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .asyncAndThen(() => ctx.auth.logout())
      .map((outcome) => toLogoutReport(outcome, ctx.auth.credentialPath)),
    renderWith(values.json, formatLogout),
  );

export const createLogoutCommand = (context: CliContext) =>
  define({
    name: 'logout',
    description: 'Revoke the stored Google refresh token and delete it locally',
    args: {
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    run: (ctx): Promise<void> => runLogout(context, ctx.values, extraArgsOf(ctx, 0)),
  });

// Flag values the command parses, derived from its own `args`.
export type LogoutValues = ArgValues<ReturnType<typeof createLogoutCommand>['args']>;
