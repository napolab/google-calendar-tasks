import { dayjs } from '@napolab/gct-core/dayjs';
import { InvalidInputError } from '@napolab/gct-core/errors';
import { Result, err, ok } from 'neverthrow';
import { z } from 'zod';

import { TOOL_TIME_ZONE, nextDate, parseDate, parseDateTime, parseTimeZone, parseWindowBound, toWindowEnd, toWindowStart } from '../../time-input';

import type { CreateEventInput, EventRef, EventTime, FieldPatch, FreeBusyInput, ListEventsInput, TimePatch, TimeZoneRef, UpdateEventInput } from '@napolab/gct-core/calendar';

// Calendar tool arguments (zod schemas the SDK advertises and validates) and their mapping to core inputs.
// The schemas check structure only; formats are checked here so the error names the argument, the value, the
// expected format and the fix (.claude/rules/mcp-write-strict.md). Pure: the clock is passed in.

const DEFAULT_WINDOW_DAYS = 7;

const DEFAULT_PAGE_SIZE = 50;

const PRIMARY_CALENDAR = 'primary';

// ---- schemas ----

const calendarIdArg = z.string().min(1).optional().describe("Calendar id from list_calendars. Default: 'primary' (the user's own calendar).");

const eventIdArg = z.string().min(1).describe('Event id from list_events.');

const windowBound = (edge: 'start' | 'end', fallback: string) =>
  z
    .string()
    .optional()
    .describe(
      `Window ${edge}: a date YYYY-MM-DD (a whole day in ${TOOL_TIME_ZONE}${edge === 'end' ? ', inclusive' : ''}) or RFC 3339 with offset (e.g. 2026-11-17T10:00:00+09:00). Default: ${fallback}.`,
    );

export const eventTimeArg = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('allDay'),
      date: z.string().describe('First day, YYYY-MM-DD.'),
      endDate: z.string().optional().describe('Last day, INCLUSIVE, YYYY-MM-DD. Omit for a one-day event.'),
    }),
    z.strictObject({
      kind: z.literal('timed'),
      start: z.string().describe('RFC 3339 with offset, e.g. 2026-11-17T10:00:00+09:00.'),
      end: z.string().describe('RFC 3339 with offset, after start.'),
      timeZone: z.string().optional().describe('IANA zone the event is anchored to, e.g. Asia/Tokyo (matters for recurring events). Omit to rely on the offsets.'),
    }),
  ])
  .describe("When the event happens: { kind: 'allDay', date, endDate? } or { kind: 'timed', start, end, timeZone? }.");

const attendeesArg = z.array(z.string()).describe('Attendee email addresses.');

export const listEventsArgs = z.strictObject({
  calendarId: calendarIdArg,
  from: windowBound('start', 'now'),
  to: windowBound('end', `${DEFAULT_WINDOW_DAYS} days after from`),
  query: z.string().optional().describe('Free-text search over summary, description, location and attendees.'),
  maxResults: z.number().int().min(1).max(2500).optional().describe(`Events per page, 1-2500. Default: ${DEFAULT_PAGE_SIZE}.`),
  pageToken: z.string().min(1).optional().describe('nextPageToken from the previous list_events call with the same arguments.'),
});

export const eventRefArgs = z.strictObject({ eventId: eventIdArg, calendarId: calendarIdArg });

export const createEventArgs = z.strictObject({
  summary: z.string().describe('Event title (non-empty).'),
  time: eventTimeArg,
  calendarId: calendarIdArg,
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: attendeesArg.optional(),
});

export const updateEventArgs = z.strictObject({
  eventId: eventIdArg,
  calendarId: calendarIdArg,
  summary: z.string().optional().describe('New title (non-empty). Omit to keep.'),
  description: z.string().optional().describe('New description. Omit to keep; use clearDescription to remove.'),
  clearDescription: z.boolean().optional().describe('true removes the description.'),
  location: z.string().optional().describe('New location. Omit to keep; use clearLocation to remove.'),
  clearLocation: z.boolean().optional().describe('true removes the location.'),
  attendees: attendeesArg.optional().describe('Replaces ALL attendees with these emails. Omit to keep; use clearAttendees to remove all.'),
  clearAttendees: z.boolean().optional().describe('true removes every attendee.'),
  time: eventTimeArg.optional().describe('New time (start and end move together). Omit to keep.'),
});

export const freeBusyArgs = z.strictObject({
  from: z.string().describe(`Window start: YYYY-MM-DD (a whole day in ${TOOL_TIME_ZONE}) or RFC 3339 with offset.`),
  to: z.string().describe(`Window end: YYYY-MM-DD (inclusive day in ${TOOL_TIME_ZONE}) or RFC 3339 with offset.`),
  calendarIds: z.array(z.string().min(1)).min(1).max(50).optional().describe("Calendar ids to check, 1-50. Default: ['primary']."),
});

export type ListEventsArgs = z.output<typeof listEventsArgs>;
export type EventRefArgs = z.output<typeof eventRefArgs>;
export type EventTimeArg = z.output<typeof eventTimeArg>;
export type CreateEventArgs = z.output<typeof createEventArgs>;
export type UpdateEventArgs = z.output<typeof updateEventArgs>;
export type FreeBusyArgs = z.output<typeof freeBusyArgs>;

// ---- shared ----

// `calendarId` is core's one optional input: omitted means 'primary'.
const calendarOf = (calendarId: string | undefined): { readonly calendarId?: string } => (calendarId === undefined ? {} : { calendarId });

const parseOptional = <T>(value: string | undefined, parse: (value: string) => Result<T, InvalidInputError>): Result<T | undefined, InvalidInputError> =>
  value === undefined ? ok(undefined) : parse(value);

const isAfter = (later: string, earlier: string): boolean => dayjs(later).isAfter(dayjs(earlier));

const requireOrder = (args: { readonly startArg: string; readonly start: string; readonly endArg: string; readonly end: string }): Result<void, InvalidInputError> => {
  if (isAfter(args.end, args.start)) return ok(undefined);
  return err(new InvalidInputError(`${args.endArg} "${args.end}" must be after ${args.startArg} "${args.start}". Pass a later ${args.endArg} (or an earlier ${args.startArg}).`));
};

const emailSchema = z.email();

const parseAttendees = (arg: string, emails: readonly string[]): Result<readonly string[], InvalidInputError> => {
  const invalid = emails.filter((email) => !emailSchema.safeParse(email).success);
  if (invalid.length === 0) return ok(emails);
  return err(
    new InvalidInputError(`${arg} contains values that are not email addresses: ${invalid.map((email) => `"${email}"`).join(', ')}. Pass attendee email addresses such as "name@example.com".`),
  );
};

export const toEventRef = (args: EventRefArgs): EventRef => ({ ...calendarOf(args.calendarId), eventId: args.eventId });

// ---- list ----

const nowInZone = (now: number): string => dayjs(now).tz(TOOL_TIME_ZONE).format();

const weekAfter = (timeMin: string): string => dayjs(timeMin).add(DEFAULT_WINDOW_DAYS, 'day').tz(TOOL_TIME_ZONE).format();

const toQuery = (query: string | undefined): Result<ListEventsInput['search'], InvalidInputError> => {
  if (query === undefined) return ok({ kind: 'none' });
  if (query.trim() === '') return err(new InvalidInputError('query is empty. Pass the text to search for, or omit query to list every event in the window.'));
  return ok({ kind: 'text', text: query });
};

// A window must end after it starts. The message shows what the caller passed and the instants it resolved to.
const requireWindowOrder = (window: { readonly from: string; readonly to: string; readonly timeMin: string; readonly timeMax: string }): Result<void, InvalidInputError> => {
  if (isAfter(window.timeMax, window.timeMin)) return ok(undefined);
  return err(
    new InvalidInputError(
      `to "${window.to}" (ends ${window.timeMax}) must be after from "${window.from}" (starts ${window.timeMin}). A date-only to is inclusive; pass a later to or an earlier from.`,
    ),
  );
};

const toWindow = (args: ListEventsArgs, now: number): Result<ListEventsInput['window'], InvalidInputError> =>
  parseOptional(args.from, (value) => parseWindowBound('from', value)).andThen((from) =>
    parseOptional(args.to, (value) => parseWindowBound('to', value)).andThen((to) => {
      const timeMin = from === undefined ? nowInZone(now) : toWindowStart(from);
      const timeMax = to === undefined ? weekAfter(timeMin) : toWindowEnd(to);
      return requireWindowOrder({ from: args.from ?? 'now', to: args.to ?? timeMax, timeMin, timeMax }).map(() => ({ kind: 'between' as const, timeMin, timeMax }));
    }),
  );

export const toListEventsInput = (args: ListEventsArgs, now: number): Result<ListEventsInput, InvalidInputError> =>
  toWindow(args, now).andThen((window) =>
    toQuery(args.query).map((search): ListEventsInput => ({
      ...calendarOf(args.calendarId),
      window,
      search,
      maxResults: args.maxResults ?? DEFAULT_PAGE_SIZE,
      page: args.pageToken === undefined ? { kind: 'first' } : { kind: 'next', pageToken: args.pageToken },
    })),
  );

// ---- event time (create / update) ----

type EventRange = { readonly start: EventTime; readonly end: EventTime };

const toLastDay = (date: string, endDate: string | undefined): Result<string, InvalidInputError> => {
  if (endDate === undefined) return ok(date);
  return parseDate('time.endDate', endDate).andThen((last) =>
    dayjs.utc(last).isBefore(dayjs.utc(date))
      ? err(new InvalidInputError(`time.endDate "${last}" is before time.date "${date}". endDate is the INCLUSIVE last day; pass a date on or after time.date, or omit it for a one-day event.`))
      : ok(last),
  );
};

// endDate is the inclusive last day; Google's all-day end is the exclusive day after it.
const toAllDayRange = (date: string, endDate: string | undefined): Result<EventRange, InvalidInputError> =>
  parseDate('time.date', date).andThen((first) => toLastDay(first, endDate).map((last): EventRange => ({ start: { kind: 'date', date: first }, end: { kind: 'date', date: nextDate(last) } })));

const toZone = (timeZone: string | undefined): Result<TimeZoneRef, InvalidInputError> =>
  timeZone === undefined ? ok({ kind: 'none' }) : parseTimeZone('time.timeZone', timeZone).map((name): TimeZoneRef => ({ kind: 'iana', name }));

const toTimedRange = (time: Extract<EventTimeArg, { kind: 'timed' }>): Result<EventRange, InvalidInputError> =>
  parseDateTime('time.start', time.start).andThen((start) =>
    parseDateTime('time.end', time.end).andThen((end) =>
      requireOrder({ startArg: 'time.start', start, endArg: 'time.end', end }).andThen(() =>
        toZone(time.timeZone).map((timeZone): EventRange => ({ start: { kind: 'dateTime', dateTime: start, timeZone }, end: { kind: 'dateTime', dateTime: end, timeZone } })),
      ),
    ),
  );

const toEventRange = (time: EventTimeArg): Result<EventRange, InvalidInputError> => {
  switch (time.kind) {
    case 'allDay':
      return toAllDayRange(time.date, time.endDate);
    case 'timed':
      return toTimedRange(time);
    default: {
      const _exhaustive: never = time;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// ---- create ----

const requireSummary = (summary: string): Result<string, InvalidInputError> => (summary.trim() === '' ? err(new InvalidInputError('summary is empty. Pass the event title.')) : ok(summary));

export const toCreateEventInput = (args: CreateEventArgs): Result<CreateEventInput, InvalidInputError> =>
  requireSummary(args.summary).andThen((summary) =>
    toEventRange(args.time).andThen((range) =>
      parseAttendees('attendees', args.attendees ?? []).map((attendees): CreateEventInput => ({
        ...calendarOf(args.calendarId),
        summary,
        description: args.description ?? '',
        location: args.location ?? '',
        ...range,
        attendees,
      })),
    ),
  );

// ---- update ----

// `<field>` sets, `clear<Field>: true` removes, neither keeps. Both, or an empty value (which would silently
// clear), are rejected.
type PatchArgs<T> = { readonly field: string; readonly clearArg: string; readonly value: T | undefined; readonly clear: boolean | undefined };

const toFieldPatch = <T extends string | readonly string[]>(args: PatchArgs<T>): Result<FieldPatch<T>, InvalidInputError> => {
  const clear = args.clear === true;
  if (args.value !== undefined && clear) return err(new InvalidInputError(`Pass either ${args.field} (to change it) or ${args.clearArg}: true (to remove it), not both.`));
  if (clear) return ok({ kind: 'clear' });
  if (args.value === undefined) return ok({ kind: 'keep' });
  if (args.value.length === 0) return err(new InvalidInputError(`${args.field} is empty. Pass a non-empty value to change it, or ${args.clearArg}: true to remove it.`));
  return ok({ kind: 'set', value: args.value });
};

const toSummaryPatch = (summary: string | undefined): Result<FieldPatch<string>, InvalidInputError> =>
  summary === undefined ? ok({ kind: 'keep' }) : requireSummary(summary).map((value): FieldPatch<string> => ({ kind: 'set', value }));

const toAttendeesPatch = (args: UpdateEventArgs): Result<FieldPatch<readonly string[]>, InvalidInputError> =>
  toFieldPatch<readonly string[]>({ field: 'attendees', clearArg: 'clearAttendees', value: args.attendees, clear: args.clearAttendees }).andThen((patch) =>
    patch.kind === 'set' ? parseAttendees('attendees', patch.value).map((value) => ({ kind: 'set' as const, value })) : ok(patch),
  );

const toTimePatch = (time: EventTimeArg | undefined): Result<TimePatch, InvalidInputError> =>
  time === undefined ? ok({ kind: 'keep' }) : toEventRange(time).map((range): TimePatch => ({ kind: 'set', ...range }));

const UPDATABLE = 'summary, description / clearDescription, location / clearLocation, attendees / clearAttendees, time';

const requireChange = (input: UpdateEventInput): Result<UpdateEventInput, InvalidInputError> => {
  if ([input.summary, input.description, input.location, input.attendees, input.time].some((patch) => patch.kind !== 'keep')) return ok(input);
  return err(new InvalidInputError(`Nothing to update for event "${input.eventId}": pass at least one of ${UPDATABLE}. Omitted fields are kept as they are.`));
};

export const toUpdateEventInput = (args: UpdateEventArgs): Result<UpdateEventInput, InvalidInputError> =>
  Result.combine([
    toSummaryPatch(args.summary),
    toFieldPatch({ field: 'description', clearArg: 'clearDescription', value: args.description, clear: args.clearDescription }),
    toFieldPatch({ field: 'location', clearArg: 'clearLocation', value: args.location, clear: args.clearLocation }),
  ]).andThen(([summary, description, location]) =>
    toAttendeesPatch(args).andThen((attendees) =>
      toTimePatch(args.time)
        .map((time): UpdateEventInput => ({ ...calendarOf(args.calendarId), eventId: args.eventId, summary, description, location, attendees, time }))
        .andThen(requireChange),
    ),
  );

// ---- free / busy ----

export const toFreeBusyInput = (args: FreeBusyArgs): Result<FreeBusyInput, InvalidInputError> =>
  parseWindowBound('from', args.from).andThen((from) =>
    parseWindowBound('to', args.to).andThen((to) => {
      const timeMin = toWindowStart(from);
      const timeMax = toWindowEnd(to);
      return requireWindowOrder({ from: args.from, to: args.to, timeMin, timeMax }).map(() => ({ timeMin, timeMax, calendarIds: args.calendarIds ?? [PRIMARY_CALENDAR] }));
    }),
  );
