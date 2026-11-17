import { dayjs } from '@napolab/gct-core/dayjs';
import { InvalidInputError } from '@napolab/gct-core/errors';
import { err, ok } from 'neverthrow';

import { CLI_TIME_ZONE, nextDate, parseDate, parseDateTime, parseWindowBound, toWindowEnd, toWindowStart } from '../../shared/flags/date';
import { toListPatch, toTextPatch } from '../../shared/flags/patch';

import type { WindowBound } from '../../shared/flags/date';
import type { CreateEventValues, GetEventValues, ListEventsValues, UpdateEventValues } from '../index';
import type { AttendeeInput, CreateEventInput, EventRef, EventTime, FieldPatch, ListEventsInput, TimePatch, TimeWindow, TimeZoneRef, UpdateEventInput } from '@napolab/gct-core/calendar';
import type { Result } from 'neverthrow';

// `gct events ...` flags (declared by the commands in ../index) and their mapping to core calendar inputs. Pure: the clock is passed in.
// CLI defaults live here because core inputs are required unions.

export const DEFAULT_WINDOW_DAYS = 7;

export const DATE_TIME_EXAMPLE = '2026-11-17T10:00:00+09:00';

type Flags<V> = Omit<V, 'eventId' | 'json'>;

export type ListEventsFlags = Flags<ListEventsValues>;
export type CreateEventFlags = Flags<CreateEventValues>;
export type UpdateEventFlags = Flags<UpdateEventValues>;
export type EventRefFlags = Flags<GetEventValues>;
type TimeFlags = Pick<CreateEventValues, 'date' | 'endDate' | 'start' | 'end' | 'timeZone'>;

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

// The CLI exposes no flags for the richer event fields: they keep Google's defaults, and the CLI never emails guests.
const CREATE_DEFAULTS = {
  recurrence: [],
  reminders: { kind: 'default' },
  color: { kind: 'calendar' },
  visibility: 'default',
  transparency: 'opaque',
  guests: { canModify: false, canInviteOthers: true, canSeeOtherGuests: true },
  conference: { kind: 'none' },
  eventType: { kind: 'default' },
  sendUpdates: 'none',
} as const satisfies Omit<CreateEventInput, keyof EventRange | 'calendarId' | 'summary' | 'description' | 'location' | 'attendees'>;

// --attendee invites a required guest.
const toAttendees = (emails: readonly string[]): readonly AttendeeInput[] => emails.map((email) => ({ email, optional: false }));

export const toCreateEventInput = (flags: CreateEventFlags): Result<CreateEventInput, InvalidInputError> =>
  toEventRange(flags).map((range) => ({
    ...calendarOf(flags.calendar),
    summary: flags.summary,
    description: flags.description ?? '',
    location: flags.location ?? '',
    ...range,
    attendees: toAttendees(flags.attendee ?? []),
    ...CREATE_DEFAULTS,
  }));

// ---- update ----

const toSummaryPatch = (summary: string | undefined): Result<FieldPatch<string>, InvalidInputError> => {
  if (summary === undefined) return ok({ kind: 'keep' });
  if (summary === '') return err(new InvalidInputError('--summary is empty. Pass a non-empty title, or leave --summary out to keep the current one.'));
  return ok({ kind: 'set', value: summary });
};

// Fields the CLI cannot change are kept; updates never email guests.
const UPDATE_KEEPS = {
  recurrence: { kind: 'keep' },
  reminders: { kind: 'keep' },
  color: { kind: 'keep' },
  visibility: { kind: 'keep' },
  transparency: { kind: 'keep' },
  guestsCanModify: { kind: 'keep' },
  guestsCanInviteOthers: { kind: 'keep' },
  guestsCanSeeOtherGuests: { kind: 'keep' },
  conference: { kind: 'keep' },
  statusProperties: { kind: 'keep' },
  sendUpdates: 'none',
} as const satisfies Partial<UpdateEventInput>;

const toAttendeesPatch = (patch: FieldPatch<readonly string[]>): FieldPatch<readonly AttendeeInput[]> => {
  switch (patch.kind) {
    case 'keep':
    case 'clear':
      return patch;
    case 'set':
      return { kind: 'set', value: toAttendees(patch.value) };
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
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
            .map((time): UpdateEventInput => ({ ...calendarOf(flags.calendar), eventId, summary, description, location, attendees: toAttendeesPatch(attendees), time, ...UPDATE_KEEPS }))
            .andThen(requireChange),
        ),
      ),
    ),
  );
