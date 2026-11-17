import { InvalidInputError } from '@napolab/gct-core/errors';
import { Result, err, ok as okResult } from 'neverthrow';
import { z } from 'zod';

import { parseTimeZone } from '../../time-input';
import { ok, toToolError } from '../../tool-result';
import { ADDITIVE, DESTRUCTIVE, IDEMPOTENT_UPDATE, PRIMARY_CALENDAR, READ_ONLY, calendarIdArg, calendarOf, requireNonEmpty, setOrKeep, toTextPatch, zoneName } from '../shared';

import type { ToolDeps } from '../../tool-deps';
import type { ToolResult } from '../../tool-result';
import type { Calendar, CreateCalendarInput, DataOwner, SetPatch, TimeZoneRef, UpdateCalendarInput } from '@napolab/gct-core/calendar';
import type { McpServer } from '@modelcontextprotocol/server';

// Calendar tools: the calendar itself (create / rename / delete secondary calendars, clear the primary one).

// ---- arguments ----

const timeZoneArg = z.string().describe('IANA time zone, e.g. Asia/Tokyo.');

export const getCalendarArgs = z.strictObject({ calendarId: calendarIdArg });

export const createCalendarArgs = z.strictObject({
  summary: z.string().describe('Calendar title (non-empty).'),
  description: z.string().optional(),
  location: z.string().optional().describe('Free-form geographic location.'),
  timeZone: timeZoneArg.optional().describe("IANA time zone, e.g. Asia/Tokyo. Default: Google's (the user's) zone."),
});

export const updateCalendarArgs = z.strictObject({
  calendarId: calendarIdArg,
  summary: z.string().optional().describe('New title (non-empty). Omit to keep.'),
  description: z.string().optional().describe('Omit to keep; clearDescription removes it.'),
  clearDescription: z.boolean().optional(),
  location: z.string().optional().describe('Omit to keep; clearLocation removes it.'),
  clearLocation: z.boolean().optional(),
  timeZone: timeZoneArg.optional().describe('New IANA time zone. Omit to keep.'),
});

export const deleteCalendarArgs = z.strictObject({ calendarId: z.string().min(1).describe("Id of a SECONDARY calendar (from list_calendars). 'primary' cannot be deleted.") });

export const clearCalendarArgs = z.strictObject({
  confirm: z.literal('delete-all-events').describe("Must be exactly 'delete-all-events'. Only pass it after the user explicitly asked to delete EVERY event of their primary calendar."),
});

export type GetCalendarArgs = z.output<typeof getCalendarArgs>;
export type CreateCalendarArgs = z.output<typeof createCalendarArgs>;
export type UpdateCalendarArgs = z.output<typeof updateCalendarArgs>;
export type DeleteCalendarArgs = z.output<typeof deleteCalendarArgs>;
export type ClearCalendarArgs = z.output<typeof clearCalendarArgs>;

// ---- mapping ----

const toZone = (timeZone: string | undefined): Result<TimeZoneRef, InvalidInputError> =>
  timeZone === undefined ? okResult({ kind: 'none' }) : parseTimeZone('timeZone', timeZone).map((name): TimeZoneRef => ({ kind: 'iana', name }));

export const toCreateCalendarInput = (args: CreateCalendarArgs): Result<CreateCalendarInput, InvalidInputError> =>
  requireNonEmpty('summary', args.summary, 'Pass the calendar title.').andThen((summary) =>
    toZone(args.timeZone).map((timeZone) => ({ summary, description: args.description ?? '', location: args.location ?? '', timeZone })),
  );

const toSummaryPatch = (summary: string | undefined): Result<SetPatch<string>, InvalidInputError> =>
  summary === undefined ? okResult({ kind: 'keep' }) : requireNonEmpty('summary', summary, 'Pass the new title, or omit summary to keep it.').map((value) => ({ kind: 'set', value }));

const toZonePatch = (timeZone: string | undefined): Result<SetPatch<string>, InvalidInputError> =>
  timeZone === undefined ? okResult({ kind: 'keep' }) : parseTimeZone('timeZone', timeZone).map((value) => setOrKeep(value));

const requireChange = (input: UpdateCalendarInput): Result<UpdateCalendarInput, InvalidInputError> => {
  if ([input.summary, input.description, input.location, input.timeZone].some((patch) => patch.kind !== 'keep')) return okResult(input);
  return err(new InvalidInputError('Nothing to update: pass at least one of summary, description / clearDescription, location / clearLocation, timeZone. Omitted fields are kept.'));
};

export const toUpdateCalendarInput = (args: UpdateCalendarArgs): Result<UpdateCalendarInput, InvalidInputError> =>
  Result.combine([
    toTextPatch({ field: 'description', clearArg: 'clearDescription', value: args.description, clear: args.clearDescription }),
    toTextPatch({ field: 'location', clearArg: 'clearLocation', value: args.location, clear: args.clearLocation }),
  ]).andThen(([description, location]) =>
    toSummaryPatch(args.summary).andThen((summary) =>
      toZonePatch(args.timeZone)
        .map((timeZone): UpdateCalendarInput => ({ ...calendarOf(args.calendarId), summary, description, location, timeZone }))
        .andThen(requireChange),
    ),
  );

// ---- view ----

export type CalendarMetadataView = {
  readonly id: string;
  readonly summary: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly timeZone: string | null;
  // Email of the owner of a secondary calendar; null for a primary one.
  readonly dataOwner: string | null;
};

const textOrNull = (value: string): string | null => (value === '' ? null : value);

const ownerOf = (owner: DataOwner): string | null => {
  switch (owner.kind) {
    case 'none':
      return null;
    case 'email':
      return owner.email;
    default: {
      const _exhaustive: never = owner;
      throw new Error(`unhandled data owner: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const toCalendarMetadataView = (calendar: Calendar): CalendarMetadataView => ({
  id: calendar.id,
  summary: calendar.summary,
  description: textOrNull(calendar.description),
  location: textOrNull(calendar.location),
  timeZone: zoneName(calendar.timeZone),
  dataOwner: ownerOf(calendar.dataOwner),
});

// ---- tools ----

export const createCalendarsToolHandlers = (deps: ToolDeps) => {
  const { calendar } = deps.services;
  const fail = toToolError(deps.connectURL);

  return {
    getCalendar: (args: GetCalendarArgs): Promise<ToolResult> => calendar.getCalendar(calendarOf(args.calendarId)).map(toCalendarMetadataView).match(ok, fail),

    createCalendar: (args: CreateCalendarArgs): Promise<ToolResult> =>
      toCreateCalendarInput(args)
        .asyncAndThen((input) => calendar.createCalendar(input))
        .map(toCalendarMetadataView)
        .match(ok, fail),

    updateCalendar: (args: UpdateCalendarArgs): Promise<ToolResult> =>
      toUpdateCalendarInput(args)
        .asyncAndThen((input) => calendar.updateCalendar(input))
        .map(toCalendarMetadataView)
        .match(ok, fail),

    deleteCalendar: (args: DeleteCalendarArgs): Promise<ToolResult> =>
      calendar
        .deleteCalendar({ calendarId: args.calendarId })
        .map(() => ({ deleted: true, calendarId: args.calendarId }))
        .match(ok, fail),

    // The schema already demanded the confirmation literal.
    clearCalendar: (_args: ClearCalendarArgs): Promise<ToolResult> =>
      calendar
        .clearPrimaryCalendar()
        .map(() => ({ cleared: true, calendarId: PRIMARY_CALENDAR }))
        .match(ok, fail),
  };
};

export const registerCalendarsTools = (server: McpServer, deps: ToolDeps): void => {
  const handlers = createCalendarsToolHandlers(deps);

  server.registerTool(
    'get_calendar',
    { title: 'Get calendar', description: 'Get a calendar’s title, description, location, time zone and owner.', inputSchema: getCalendarArgs, annotations: READ_ONLY },
    handlers.getCalendar,
  );

  server.registerTool(
    'create_calendar',
    {
      title: 'Create calendar',
      description: 'Create a new secondary calendar owned by the user. Returns its id (use it as calendarId in the other tools).',
      inputSchema: createCalendarArgs,
      annotations: ADDITIVE,
    },
    handlers.createCalendar,
  );

  server.registerTool(
    'update_calendar',
    {
      title: 'Update calendar',
      description:
        'Rename a calendar or change its description, location or time zone (for everyone who sees it). Omitted fields are kept. To rename it only for this user use update_calendar_list_entry.',
      inputSchema: updateCalendarArgs,
      annotations: IDEMPOTENT_UPDATE,
    },
    handlers.updateCalendar,
  );

  server.registerTool(
    'delete_calendar',
    {
      title: 'Delete calendar',
      description:
        "Permanently delete a SECONDARY calendar the user owns, with all its events, for everyone it is shared with. Cannot be undone. 'primary' cannot be deleted (see clear_calendar). To only stop seeing someone else's calendar use unsubscribe_calendar.",
      inputSchema: deleteCalendarArgs,
      annotations: DESTRUCTIVE,
    },
    handlers.deleteCalendar,
  );

  server.registerTool(
    'clear_calendar',
    {
      title: 'Delete ALL events of the primary calendar',
      description:
        "DANGER: deletes EVERY event of the user's primary calendar (past and future). Cannot be undone. Only call it when the user explicitly asked to wipe their whole primary calendar, and pass confirm: 'delete-all-events'. To delete one event use delete_event.",
      inputSchema: clearCalendarArgs,
      annotations: DESTRUCTIVE,
    },
    handlers.clearCalendar,
  );
};
