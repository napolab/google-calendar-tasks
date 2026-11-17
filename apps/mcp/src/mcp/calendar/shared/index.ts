import { InvalidInputError } from '@napolab/gct-core/errors';
import { Result, err, ok } from 'neverthrow';
import { z } from 'zod';

import type { FieldPatch, NextPage, SendUpdates, SetPatch, TimeZoneRef } from '@napolab/gct-core/calendar';
import type { ToolAnnotations } from '@modelcontextprotocol/server';

// Pieces every calendar tool module shares: common arguments, their mapping to core, and the annotation presets.

export const PRIMARY_CALENDAR = 'primary';

export const calendarIdArg = z.string().min(1).optional().describe("Calendar id from list_calendars. Default: 'primary' (the user's own calendar).");

export const sendUpdatesArg = z
  .enum(['none', 'externalOnly', 'all'])
  .optional()
  .describe("Who Google emails about this change: 'none' (default — no email is sent), 'externalOnly' (only non-Google-Calendar guests) or 'all'. Only pass it when the user asked to notify guests.");

// No notification email unless the caller asked for one.
export const toSendUpdates = (sendUpdates: SendUpdates | undefined): SendUpdates => sendUpdates ?? 'none';

export const NOTIFY_NOTE = 'Guests are NOT emailed unless sendUpdates says so.';

// `calendarId` is core's one optional input: omitted means 'primary'.
export const calendarOf = (calendarId: string | undefined): { readonly calendarId?: string } => (calendarId === undefined ? {} : { calendarId });

export const nextPageToken = (nextPage: NextPage): string | null => {
  switch (nextPage.kind) {
    case 'none':
      return null;
    case 'next':
      return nextPage.pageToken;
    default: {
      const _exhaustive: never = nextPage;
      throw new Error(`unhandled next page: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const zoneName = (zone: TimeZoneRef): string | null => {
  switch (zone.kind) {
    case 'none':
      return null;
    case 'iana':
      return zone.name;
    default: {
      const _exhaustive: never = zone;
      throw new Error(`unhandled time zone: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const setOrKeep = <T>(value: T | undefined): SetPatch<T> => (value === undefined ? { kind: 'keep' } : { kind: 'set', value });

// `<field>` sets, `clear<Field>: true` removes, neither keeps. Both, or an empty value (which would silently clear), are
// rejected.
export type PatchArgs = { readonly field: string; readonly clearArg: string; readonly value: string | undefined; readonly clear: boolean | undefined };

export const toTextPatch = (args: PatchArgs): Result<FieldPatch<string>, InvalidInputError> => {
  const clear = args.clear === true;
  if (args.value !== undefined && clear) return err(new InvalidInputError(`Pass either ${args.field} (to change it) or ${args.clearArg}: true (to remove it), not both.`));
  if (clear) return ok({ kind: 'clear' });
  if (args.value === undefined) return ok({ kind: 'keep' });
  if (args.value.trim() === '') return err(new InvalidInputError(`${args.field} is empty. Pass a non-empty value to change it, or ${args.clearArg}: true to remove it.`));
  return ok({ kind: 'set', value: args.value });
};

export const requireNonEmpty = (arg: string, value: string, hint: string): Result<string, InvalidInputError> =>
  value.trim() === '' ? err(new InvalidInputError(`${arg} is empty. ${hint}`)) : ok(value);

// Annotation presets (MCP ToolAnnotations hints). Every calendar tool uses exactly one.
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

// Adds something new; calling twice adds twice.
export const ADDITIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

// Changes fields in place; repeating the same call changes nothing more.
export const IDEMPOTENT_UPDATE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };

// Removes data or access and cannot be undone by calling again.
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
