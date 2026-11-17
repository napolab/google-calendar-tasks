import { DEFAULT_TIME_ZONE, dayjs } from '@napolab/gct-core/dayjs';
import { InvalidInputError } from '@napolab/gct-core/errors';
import { Result, err, ok } from 'neverthrow';
import { z } from 'zod';

// Date / date-time tool arguments (.claude/rules/mcp-write-strict.md): reject instead of guessing, and name the
// argument, the offending value, the accepted format and how to fix it. Mirrors the CLI's flag parsing.

// The zone date-only arguments are read in.
export const TOOL_TIME_ZONE: string = DEFAULT_TIME_ZONE;

const DATE_FORMAT = 'a calendar date in YYYY-MM-DD, e.g. "2026-11-17"';

const DATE_TIME_FORMAT = 'RFC 3339 with an explicit offset, e.g. "2026-11-17T10:00:00+09:00" or "2026-11-17T01:00:00Z"';

// z.iso rejects impossible dates (2026-02-30) and hours (25:00) that dayjs would silently roll over.
const dateSchema = z.iso.date();

const dateTimeSchema = z.iso.datetime({ offset: true });

const isDate = (value: string): boolean => dateSchema.safeParse(value).success;

const isDateTime = (value: string): boolean => dateTimeSchema.safeParse(value).success;

export const parseDate = (arg: string, value: string): Result<string, InvalidInputError> => {
  if (isDate(value)) return ok(value);
  return err(new InvalidInputError(`${arg} "${value}" is not ${DATE_FORMAT}. Pass the date in that format and retry.`));
};

export const parseDateTime = (arg: string, value: string): Result<string, InvalidInputError> => {
  if (isDateTime(value)) return ok(value);
  return err(new InvalidInputError(`${arg} "${value}" is not ${DATE_TIME_FORMAT}. Add the offset explicitly (Asia/Tokyo is +09:00) and retry.`));
};

// Intl throws a RangeError for a zone it does not know (Node and Workers alike).
const isTimeZone = (timeZone: string): boolean =>
  Result.fromThrowable(
    () => new Intl.DateTimeFormat('en-US', { timeZone }),
    () => undefined,
  )().isOk();

export const parseTimeZone = (arg: string, value: string): Result<string, InvalidInputError> => {
  if (isTimeZone(value)) return ok(value);
  return err(new InvalidInputError(`${arg} "${value}" is not an IANA time zone name such as "Asia/Tokyo" or "UTC". Pass a valid IANA name, or omit it to rely on the offset alone.`));
};

// A bound of a time window: a whole day (read in Asia/Tokyo) or an exact instant.
export type WindowBound = { readonly kind: 'date'; readonly date: string } | { readonly kind: 'dateTime'; readonly dateTime: string };

export const parseWindowBound = (arg: string, value: string): Result<WindowBound, InvalidInputError> => {
  if (isDate(value)) return ok({ kind: 'date', date: value });
  if (isDateTime(value)) return ok({ kind: 'dateTime', dateTime: value });
  return err(new InvalidInputError(`${arg} "${value}" is neither ${DATE_FORMAT} (a whole day in ${TOOL_TIME_ZONE}) nor ${DATE_TIME_FORMAT}. Pass one of those formats and retry.`));
};

// The first instant of the bound: a date starts at its midnight in Asia/Tokyo.
export const toWindowStart = (bound: WindowBound): string => {
  switch (bound.kind) {
    case 'date':
      return dayjs.tz(bound.date, TOOL_TIME_ZONE).format();
    case 'dateTime':
      return bound.dateTime;
    default: {
      const _exhaustive: never = bound;
      throw new Error(`unhandled window bound: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// The instant the bound ends at: a date is inclusive, so it ends at the following midnight in Asia/Tokyo.
export const toWindowEnd = (bound: WindowBound): string => {
  switch (bound.kind) {
    case 'date':
      return dayjs.tz(bound.date, TOOL_TIME_ZONE).add(1, 'day').format();
    case 'dateTime':
      return bound.dateTime;
    default: {
      const _exhaustive: never = bound;
      throw new Error(`unhandled window bound: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Calendar arithmetic on YYYY-MM-DD strings (zone-free: UTC has no DST gaps).
export const nextDate = (date: string): string => dayjs.utc(date).add(1, 'day').format('YYYY-MM-DD');

// Google's all-day end date is exclusive; tools speak the inclusive last day.
export const inclusiveEndDate = (exclusiveEnd: string): string => dayjs.utc(exclusiveEnd).subtract(1, 'day').format('YYYY-MM-DD');
