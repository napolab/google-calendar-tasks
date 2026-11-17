import { dayjs } from '@napolab/gct-core/dayjs';
import { InvalidInputError } from '@napolab/gct-core/errors';
import { err, ok } from 'neverthrow';

import { CLI_TIME_ZONE, nextDate, parseDate, parseDateTime, parseWindowBound, toWindowEnd, toWindowStart } from '../../shared/flags/date';
import { jsonArg } from '../../shared/flags/json';
import { toListPatch, toTextPatch } from '../../shared/flags/patch';

import type { WindowBound } from '../../shared/flags/date';
import type { CreateEventInput, EventRef, EventTime, FieldPatch, ListEventsInput, TimePatch, TimeWindow, TimeZoneRef, UpdateEventInput } from '@napolab/gct-core/calendar';
import type { ArgValues, Args } from 'gunshi';
import type { Result } from 'neverthrow';

// `gct events ...` flags and their mapping to core calendar inputs. Pure: the clock is passed in.
// CLI defaults live here because core inputs are required unions.

const DEFAULT_WINDOW_DAYS = 7;

const DATE_TIME_EXAMPLE = '2026-11-17T10:00:00+09:00';

// ---- flag schemas ----

const calendarArg = {
  calendar: { type: 'string', description: "Calendar id (default: your primary calendar; see 'gct calendars')" },
} satisfies Args;

const eventIdArg = {
  eventId: { type: 'positional', description: 'Event id (shown in brackets by `gct events list`)' },
} satisfies Args;

const timeArgs = {
  date: { type: 'string', description: 'All-day event on this date (YYYY-MM-DD)' },
  endDate: { type: 'string', description: 'Last day of a multi-day all-day event, inclusive (YYYY-MM-DD; needs --date)' },
  start: { type: 'string', description: `Start of a timed event, RFC 3339 with offset (e.g. ${DATE_TIME_EXAMPLE})` },
  end: { type: 'string', description: 'End of a timed event, RFC 3339 with offset' },
  timeZone: { type: 'string', description: 'IANA zone a timed event is anchored to (e.g. Asia/Tokyo); the offset alone is used when absent' },
} satisfies Args;

export const listEventsArgs = {
  ...calendarArg,
  from: { type: 'string', description: `Window start: YYYY-MM-DD (Asia/Tokyo) or RFC 3339 with offset (default: now)` },
  to: { type: 'string', description: `Window end: YYYY-MM-DD (inclusive day, Asia/Tokyo) or RFC 3339 with offset (default: ${DEFAULT_WINDOW_DAYS} days after --from)` },
  search: { type: 'string', description: 'Free-text search over summary, description, location and attendees' },
  max: { type: 'number', default: 50, description: 'Events per page (1-2500)' },
  pageToken: { type: 'string', description: 'Page token printed by the previous page' },
  ...jsonArg,
} satisfies Args;

export const eventRefArgs = { ...eventIdArg, ...calendarArg, ...jsonArg } satisfies Args;

export const createEventArgs = {
  summary: { type: 'string', required: true, description: 'Event title' },
  ...timeArgs,
  description: { type: 'string', description: 'Event description' },
  location: { type: 'string', description: 'Event location' },
  attendee: { type: 'string', multiple: true, description: 'Attendee email (repeat for several)' },
  ...calendarArg,
  ...jsonArg,
} satisfies Args;

export const updateEventArgs = {
  ...eventIdArg,
  summary: { type: 'string', description: 'New title' },
  description: { type: 'string', description: 'New description' },
  clearDescription: { type: 'boolean', description: 'Remove the description' },
  location: { type: 'string', description: 'New location' },
  clearLocation: { type: 'boolean', description: 'Remove the location' },
  attendee: { type: 'string', multiple: true, description: 'Replace the attendees with these emails (repeat for several)' },
  clearAttendees: { type: 'boolean', description: 'Remove every attendee' },
  ...timeArgs,
  ...calendarArg,
  ...jsonArg,
} satisfies Args;

type Flags<A extends Args> = Omit<ArgValues<A>, 'eventId' | 'json'>;

export type ListEventsFlags = Flags<typeof listEventsArgs>;
export type CreateEventFlags = Flags<typeof createEventArgs>;
export type UpdateEventFlags = Flags<typeof updateEventArgs>;
export type EventRefFlags = Flags<typeof eventRefArgs>;
type TimeFlags = Flags<typeof timeArgs>;

// ---- shared ----

// `calendarId` is the one optional core input; it is omitted (→ 'primary') unless --calendar is given.
const calendarOf = (calendar: string | undefined): { readonly calendarId?: string } => (calendar === undefined ? {} : { calendarId: calendar });

const parseOptional = <T>(value: string | undefined, parse: (value: string) => Result<T, InvalidInputError>): Result<T | undefined, InvalidInputError> =>
  value === undefined ? ok(undefined) : parse(value);

export const toEventRef = (eventId: string, flags: EventRefFlags): EventRef => ({ ...calendarOf(flags.calendar), eventId });

// ---- list ----

const nowInZone = (now: number): string => dayjs(now).tz(CLI_TIME_ZONE).format();

const defaultEnd = (timeMin: string): string => dayjs(timeMin).add(DEFAULT_WINDOW_DAYS, 'day').tz(CLI_TIME_ZONE).format();

const toWindow = (from: WindowBound | undefined, to: WindowBound | undefined, now: number): TimeWindow => {
  const timeMin = from === undefined ? nowInZone(now) : toWindowStart(from);
  const timeMax = to === undefined ? defaultEnd(timeMin) : toWindowEnd(to);
  return { kind: 'between', timeMin, timeMax };
};

export const toListEventsInput = (flags: ListEventsFlags, now: number): Result<ListEventsInput, InvalidInputError> =>
  parseOptional(flags.from, (value) => parseWindowBound('--from', value)).andThen((from) =>
    parseOptional(flags.to, (value) => parseWindowBound('--to', value)).map((to): ListEventsInput => ({
      ...calendarOf(flags.calendar),
      window: toWindow(from, to, now),
      search: flags.search === undefined ? { kind: 'none' } : { kind: 'text', text: flags.search },
      maxResults: flags.max,
      page: flags.pageToken === undefined ? { kind: 'first' } : { kind: 'next', pageToken: flags.pageToken },
    })),
  );

// ---- event time (create / update) ----

type EventRange = { readonly start: EventTime; readonly end: EventTime };

type TimeMode = 'none' | 'allDay' | 'timed' | 'conflict';

const hasAllDayFlags = (flags: TimeFlags): boolean => flags.date !== undefined || flags.endDate !== undefined;

const hasTimedFlags = (flags: TimeFlags): boolean => flags.start !== undefined || flags.end !== undefined || flags.timeZone !== undefined;

const timeModeOf = (flags: TimeFlags): TimeMode => {
  const modes = { 'false-false': 'none', 'true-false': 'allDay', 'false-true': 'timed', 'true-true': 'conflict' } satisfies Record<`${boolean}-${boolean}`, TimeMode>;
  return modes[`${hasAllDayFlags(flags)}-${hasTimedFlags(flags)}`];
};

const TIME_USAGE = `--date YYYY-MM-DD [--end-date YYYY-MM-DD] for an all-day event, or --start and --end (RFC 3339 with offset, e.g. ${DATE_TIME_EXAMPLE}) [--time-zone IANA] for a timed event`;

const conflictError = (): InvalidInputError => new InvalidInputError(`All-day flags (--date / --end-date) and timed flags (--start / --end / --time-zone) cannot be mixed. Pass either ${TIME_USAGE}.`);

const missingTimeError = (): InvalidInputError => new InvalidInputError(`The event needs a time. Pass ${TIME_USAGE}.`);

const requireDate = (date: string | undefined): Result<string, InvalidInputError> =>
  date === undefined ? err(new InvalidInputError('--end-date needs --date (the first day). Pass --date YYYY-MM-DD as well.')) : ok(date);

const requireOrder = (date: string, lastDate: string): Result<string, InvalidInputError> =>
  dayjs.utc(lastDate).isBefore(dayjs.utc(date))
    ? err(new InvalidInputError(`--end-date "${lastDate}" is before --date "${date}". --end-date is the last day of the event (inclusive); pass a date on or after --date.`))
    : ok(lastDate);

// --end-date is the inclusive last day; Google's all-day end is the exclusive day after it.
const toAllDayRange = (flags: TimeFlags): Result<EventRange, InvalidInputError> =>
  parseOptional(flags.date, (value) => parseDate('--date', value)).andThen((date) =>
    parseOptional(flags.endDate, (value) => parseDate('--end-date', value)).andThen((endDate) =>
      requireDate(date).andThen((first) =>
        (endDate === undefined ? ok(first) : requireOrder(first, endDate)).map((last): EventRange => ({ start: { kind: 'date', date: first }, end: { kind: 'date', date: nextDate(last) } })),
      ),
    ),
  );

const toZone = (timeZone: string | undefined): TimeZoneRef => (timeZone === undefined ? { kind: 'none' } : { kind: 'iana', name: timeZone });

const requireBoth = (start: string | undefined, end: string | undefined): Result<{ readonly start: string; readonly end: string }, InvalidInputError> => {
  if (start !== undefined && end !== undefined) return ok({ start, end });
  return err(
    new InvalidInputError(`A timed event needs both --start and --end (RFC 3339 with offset, e.g. ${DATE_TIME_EXAMPLE}). Pass the missing one, or use --date YYYY-MM-DD for an all-day event.`),
  );
};

// Each given value is checked before the pair is, so a malformed --start is reported even when --end is missing.
const toTimedRange = (flags: TimeFlags): Result<EventRange, InvalidInputError> =>
  parseOptional(flags.start, (value) => parseDateTime('--start', value)).andThen((start) =>
    parseOptional(flags.end, (value) => parseDateTime('--end', value)).andThen((end) =>
      requireBoth(start, end).map((pair): EventRange => ({
        start: { kind: 'dateTime', dateTime: pair.start, timeZone: toZone(flags.timeZone) },
        end: { kind: 'dateTime', dateTime: pair.end, timeZone: toZone(flags.timeZone) },
      })),
    ),
  );

const toTimePatch = (flags: TimeFlags): Result<TimePatch, InvalidInputError> => {
  const mode = timeModeOf(flags);
  switch (mode) {
    case 'none':
      return ok({ kind: 'keep' });
    case 'conflict':
      return err(conflictError());
    case 'allDay':
      return toAllDayRange(flags).map((range) => ({ kind: 'set', ...range }));
    case 'timed':
      return toTimedRange(flags).map((range) => ({ kind: 'set', ...range }));
    default: {
      const _exhaustive: never = mode;
      throw new Error(`unhandled time mode: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toEventRange = (flags: TimeFlags): Result<EventRange, InvalidInputError> =>
  toTimePatch(flags).andThen((patch) => {
    switch (patch.kind) {
      case 'keep':
        return err(missingTimeError());
      case 'set':
        return ok({ start: patch.start, end: patch.end });
      default: {
        const _exhaustive: never = patch;
        throw new Error(`unhandled time patch: ${JSON.stringify(_exhaustive)}`);
      }
    }
  });

// ---- create ----

export const toCreateEventInput = (flags: CreateEventFlags): Result<CreateEventInput, InvalidInputError> =>
  toEventRange(flags).map((range) => ({
    ...calendarOf(flags.calendar),
    summary: flags.summary,
    description: flags.description ?? '',
    location: flags.location ?? '',
    ...range,
    attendees: flags.attendee ?? [],
  }));

// ---- update ----

const toSummaryPatch = (summary: string | undefined): Result<FieldPatch<string>, InvalidInputError> => {
  if (summary === undefined) return ok({ kind: 'keep' });
  if (summary === '') return err(new InvalidInputError('--summary is empty. Pass a non-empty title, or leave --summary out to keep the current one.'));
  return ok({ kind: 'set', value: summary });
};

const UPDATE_FLAGS = '--summary, --description / --clear-description, --location / --clear-location, --attendee / --clear-attendees, or the time flags (--date / --start / --end)';

const requireChange = (input: UpdateEventInput): Result<UpdateEventInput, InvalidInputError> => {
  const changes = [input.summary, input.description, input.location, input.attendees, input.time].some((patch) => patch.kind !== 'keep');
  if (changes) return ok(input);
  return err(new InvalidInputError(`Nothing to update for event "${input.eventId}". Pass at least one of ${UPDATE_FLAGS}.`));
};

export const toUpdateEventInput = (eventId: string, flags: UpdateEventFlags): Result<UpdateEventInput, InvalidInputError> =>
  toSummaryPatch(flags.summary).andThen((summary) =>
    toTextPatch('description', flags.description, flags.clearDescription).andThen((description) =>
      toTextPatch('location', flags.location, flags.clearLocation).andThen((location) =>
        toListPatch({ set: 'attendee', clear: 'attendees' }, flags.attendee, flags.clearAttendees).andThen((attendees) =>
          toTimePatch(flags)
            .map((time): UpdateEventInput => ({ ...calendarOf(flags.calendar), eventId, summary, description, location, attendees, time }))
            .andThen(requireChange),
        ),
      ),
    ),
  );
