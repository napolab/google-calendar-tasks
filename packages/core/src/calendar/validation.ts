import { Result, err, ok } from 'neverthrow';
import { z } from 'zod';

import { dayjs } from '../dayjs';
import { InvalidInputError } from '../errors';

import type { EventSearch, EventTime, FieldPatch, FreeBusyInput, SetPatch, TimeWindow, TimeZoneRef } from './index';

// Write-side validators (.claude/rules/mcp-write-strict.md): reject instead of coercing, and say
// what was wrong, the expected format, and how to fix it — all before any request is sent.

const DATE_TIME_FORMAT = 'RFC 3339 with an explicit UTC offset, e.g. "2026-11-17T10:00:00+09:00" or "2026-11-17T01:00:00Z"';

const DATE_FORMAT = 'an existing calendar date in YYYY-MM-DD, e.g. "2026-11-17"';

const MAX_RESULTS_LIMIT = 2500;

const FREE_BUSY_CALENDAR_LIMIT = 50;

// z.iso rejects impossible dates (2026-02-30) and hours (25:00) that dayjs / Date would roll over.
const dateSchema = z.iso.date();

const dateTimeSchema = z.iso.datetime({ offset: true });

const isDate = (value: string): boolean => dateSchema.safeParse(value).success;

const isDateTime = (value: string): boolean => dateTimeSchema.safeParse(value).success;

// Intl throws a RangeError for a zone it does not know; it is available on Node and Workers alike.
const isTimeZone = (timeZone: string): boolean =>
  Result.fromThrowable(
    () => new Intl.DateTimeFormat('en-US', { timeZone }),
    () => undefined,
  )().isOk();

const isBefore = (earlier: string, later: string): boolean => dayjs(earlier).isBefore(dayjs(later));

const isBeforeDate = (earlier: string, later: string): boolean => dayjs.utc(earlier).isBefore(dayjs.utc(later));

const nextDate = (date: string): string => dayjs.utc(date).add(1, 'day').format('YYYY-MM-DD');

// ---- single values ----

export const validateDate = (field: string, value: string): Result<string, InvalidInputError> => {
  if (isDate(value)) return ok(value);
  return err(new InvalidInputError(`${field} "${value}" is not ${DATE_FORMAT}. Pass the date in that format and retry.`));
};

export const validateDateTime = (field: string, value: string): Result<string, InvalidInputError> => {
  if (isDateTime(value)) return ok(value);
  return err(new InvalidInputError(`${field} "${value}" is not ${DATE_TIME_FORMAT}. Add the offset explicitly (Asia/Tokyo is +09:00) and retry.`));
};

export const validateTimeZoneRef = (field: string, zone: TimeZoneRef): Result<TimeZoneRef, InvalidInputError> => {
  switch (zone.kind) {
    case 'none':
      return ok(zone);
    case 'iana':
      if (isTimeZone(zone.name)) return ok(zone);
      return err(new InvalidInputError(`${field} "${zone.name}" is not an IANA time zone name, e.g. "Asia/Tokyo" or "UTC". Pass a valid IANA zone, or { kind: 'none' } to rely on the offset alone.`));
    default: {
      const _exhaustive: never = zone;
      throw new Error(`unhandled time zone: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const validateTimeZoneName = (field: string, name: string): Result<string, InvalidInputError> => {
  if (isTimeZone(name)) return ok(name);
  return err(new InvalidInputError(`${field} "${name}" is not an IANA time zone name, e.g. "Asia/Tokyo" or "UTC". Pass a valid IANA zone.`));
};

export const validateMaxResults = (maxResults: number, limit: number = MAX_RESULTS_LIMIT): Result<number, InvalidInputError> => {
  if (maxResults % 1 === 0 && maxResults >= 1 && maxResults <= limit) return ok(maxResults);
  return err(new InvalidInputError(`maxResults ${maxResults} is out of range: expected an integer from 1 to ${limit}. Pass a smaller page size and follow nextPage for more results.`));
};

export const validateSearch = (search: EventSearch): Result<EventSearch, InvalidInputError> => {
  switch (search.kind) {
    case 'none':
      return ok(search);
    case 'text':
      if (search.text !== '') return ok(search);
      return err(new InvalidInputError(`search.text is empty. Pass a non-empty text to search for, or { kind: 'none' } to list without searching.`));
    default: {
      const _exhaustive: never = search;
      throw new Error(`unhandled search: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// ---- time windows (listEvents / freeBusy) ----

const validateWindowOrder = (timeMin: string, timeMax: string): Result<void, InvalidInputError> => {
  if (isBefore(timeMin, timeMax)) return ok(undefined);
  return err(new InvalidInputError(`timeMin "${timeMin}" must be before timeMax "${timeMax}". Pass a timeMax later than timeMin (both ${DATE_TIME_FORMAT}).`));
};

const validateBetween = (timeMin: string, timeMax: string): Result<void, InvalidInputError> =>
  validateDateTime('timeMin', timeMin)
    .andThen(() => validateDateTime('timeMax', timeMax))
    .andThen(() => validateWindowOrder(timeMin, timeMax));

export const validateTimeWindow = (window: TimeWindow): Result<TimeWindow, InvalidInputError> => {
  switch (window.kind) {
    case 'all':
      return ok(window);
    case 'from':
      return validateDateTime('timeMin', window.timeMin).map(() => window);
    case 'until':
      return validateDateTime('timeMax', window.timeMax).map(() => window);
    case 'between':
      return validateBetween(window.timeMin, window.timeMax).map(() => window);
    default: {
      const _exhaustive: never = window;
      throw new Error(`unhandled window: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateCalendarIds = (calendarIds: readonly string[]): Result<readonly string[], InvalidInputError> => {
  if (calendarIds.length >= 1 && calendarIds.length <= FREE_BUSY_CALENDAR_LIMIT) return ok(calendarIds);
  return err(
    new InvalidInputError(
      `calendarIds has ${calendarIds.length} entries: expected 1 to ${FREE_BUSY_CALENDAR_LIMIT} calendar ids. Pass 'primary' for your own calendar, or split the query into batches of ${FREE_BUSY_CALENDAR_LIMIT}.`,
    ),
  );
};

export const validateFreeBusy = (input: FreeBusyInput): Result<FreeBusyInput, InvalidInputError> =>
  validateBetween(input.timeMin, input.timeMax)
    .andThen(() => validateCalendarIds(input.calendarIds))
    .map(() => input);

// ---- event times ----

export const validateEventTime = (field: string, time: EventTime): Result<EventTime, InvalidInputError> => {
  switch (time.kind) {
    case 'date':
      return validateDate(`${field}.date`, time.date).map(() => time);
    case 'dateTime':
      return validateDateTime(`${field}.dateTime`, time.dateTime)
        .andThen(() => validateTimeZoneRef(`${field}.timeZone`, time.timeZone))
        .map(() => time);
    default: {
      const _exhaustive: never = time;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const describeTime = (time: EventTime): string => {
  switch (time.kind) {
    case 'date':
      return `an all-day date ("${time.date}")`;
    case 'dateTime':
      return `a timed dateTime ("${time.dateTime}")`;
    default: {
      const _exhaustive: never = time;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const mixedKindsError = (start: EventTime, end: EventTime): InvalidInputError =>
  new InvalidInputError(
    `start is ${describeTime(start)} but end is ${describeTime(end)}; start and end must be the same kind. Use { kind: 'date' } for both (all-day, end date exclusive) or { kind: 'dateTime' } for both.`,
  );

const validateDateOrder = (start: string, end: string): Result<void, InvalidInputError> => {
  if (isBeforeDate(start, end)) return ok(undefined);
  return err(new InvalidInputError(`end.date "${end}" must be after start.date "${start}". All-day end dates are exclusive: a one-day event on ${start} has end.date "${nextDate(start)}".`));
};

const validateDateTimeOrder = (start: string, end: string): Result<void, InvalidInputError> => {
  if (isBefore(start, end)) return ok(undefined);
  return err(new InvalidInputError(`end.dateTime "${end}" must be after start.dateTime "${start}". Pass an end later than the start.`));
};

const validateOrder = (start: EventTime, end: EventTime): Result<void, InvalidInputError> => {
  switch (start.kind) {
    case 'date':
      return end.kind === 'date' ? validateDateOrder(start.date, end.date) : err(mixedKindsError(start, end));
    case 'dateTime':
      return end.kind === 'dateTime' ? validateDateTimeOrder(start.dateTime, end.dateTime) : err(mixedKindsError(start, end));
    default: {
      const _exhaustive: never = start;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export type EventRange = { readonly start: EventTime; readonly end: EventTime };

// Both ends well-formed, the same kind, and end strictly after start.
export const validateEventRange = <R extends EventRange>(range: R): Result<R, InvalidInputError> =>
  validateEventTime('start', range.start)
    .andThen(() => validateEventTime('end', range.end))
    .andThen(() => validateOrder(range.start, range.end))
    .map(() => range);

// ---- shared write helpers ----

export const validateNonEmpty = (field: string, value: string, hint: string): Result<string, InvalidInputError> =>
  value.trim() === '' ? err(new InvalidInputError(`${field} is empty. ${hint}`)) : ok(value);

// A set text must be non-empty: an empty value would duplicate `clear` (or silently erase a required field).
export const validateTextPatch = (field: string, patch: FieldPatch<string>): Result<void, InvalidInputError> => {
  if (patch.kind !== 'set' || patch.value.trim() !== '') return ok(undefined);
  return err(
    new InvalidInputError(
      `${field} is set to an empty value. Use { kind: 'clear' } to remove the ${field}, { kind: 'set', value } with a non-empty value to change it, or { kind: 'keep' } to leave it untouched.`,
    ),
  );
};

// Runs `validate` on a set value; keep / clear pass through.
export const validateSet = <T>(patch: FieldPatch<T> | SetPatch<T>, validate: (value: T) => Result<unknown, InvalidInputError>): Result<void, InvalidInputError> =>
  patch.kind === 'set' ? validate(patch.value).map(() => undefined) : ok(undefined);

// Every field is `keep`: the request would change nothing, so it is rejected with the fields that can change.
export const validateHasChange = (operation: string, patches: readonly { readonly kind: string }[], fields: readonly string[]): Result<void, InvalidInputError> => {
  if (patches.some((patch) => patch.kind !== 'keep')) return ok(undefined);
  return err(new InvalidInputError(`${operation} has no field to change: every field is { kind: 'keep' }. Set at least one of ${fields.join(', ')} to { kind: 'set', ... } (or { kind: 'clear' }).`));
};
