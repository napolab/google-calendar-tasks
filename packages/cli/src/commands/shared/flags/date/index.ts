import { DEFAULT_TIME_ZONE, dayjs } from '@napolab/gct-core/dayjs';
import { InvalidInputError } from '@napolab/gct-core/errors';
import { err, ok } from 'neverthrow';
import { z } from 'zod';

import type { Result } from 'neverthrow';

// Date / date-time flag parsing (.claude/rules/mcp-write-strict.md): reject instead of guessing, and name the
// flag, the offending value and the accepted formats. The schemas mirror core's own validators, so the CLI never
// accepts a value core would reject.

// The zone the CLI reads date-only flags in and shows times in.
export const CLI_TIME_ZONE: string = DEFAULT_TIME_ZONE;

const DATE_FORMAT = 'a calendar date in YYYY-MM-DD, e.g. "2026-11-17"';

const DATE_TIME_FORMAT = 'an RFC 3339 date-time with an explicit offset, e.g. "2026-11-17T10:00:00+09:00" or "2026-11-17T01:00:00Z"';

// z.iso rejects impossible dates (2026-02-30) and hours (25:00) that dayjs would silently roll over.
const dateSchema = z.iso.date();

const dateTimeSchema = z.iso.datetime({ offset: true });

const isDate = (value: string): boolean => dateSchema.safeParse(value).success;

const isDateTime = (value: string): boolean => dateTimeSchema.safeParse(value).success;

// A bound of an event window: a whole day (read in Asia/Tokyo) or an exact instant.
export type WindowBound = { readonly kind: 'date'; readonly date: string } | { readonly kind: 'dateTime'; readonly dateTime: string };

export const parseDate = (flag: string, value: string): Result<string, InvalidInputError> => {
  if (isDate(value)) return ok(value);
  return err(new InvalidInputError(`${flag} "${value}" is not ${DATE_FORMAT}. Pass the date in that format and retry.`));
};

export const parseDateTime = (flag: string, value: string): Result<string, InvalidInputError> => {
  if (isDateTime(value)) return ok(value);
  return err(new InvalidInputError(`${flag} "${value}" is not ${DATE_TIME_FORMAT}. Add the offset explicitly (Asia/Tokyo is +09:00) and retry.`));
};

export const parseWindowBound = (flag: string, value: string): Result<WindowBound, InvalidInputError> => {
  if (isDate(value)) return ok({ kind: 'date', date: value });
  if (isDateTime(value)) return ok({ kind: 'dateTime', dateTime: value });
  return err(new InvalidInputError(`${flag} "${value}" is neither ${DATE_FORMAT} (read in ${CLI_TIME_ZONE}) nor ${DATE_TIME_FORMAT}. Pass one of those formats and retry.`));
};

// The first instant of the bound: a date starts at its midnight in Asia/Tokyo.
export const toWindowStart = (bound: WindowBound): string => {
  switch (bound.kind) {
    case 'date':
      return dayjs.tz(bound.date, CLI_TIME_ZONE).format();
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
      return dayjs.tz(bound.date, CLI_TIME_ZONE).add(1, 'day').format();
    case 'dateTime':
      return bound.dateTime;
    default: {
      const _exhaustive: never = bound;
      throw new Error(`unhandled window bound: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Calendar arithmetic on a YYYY-MM-DD string (zone-free: UTC never has DST gaps).
export const nextDate = (date: string): string => dayjs.utc(date).add(1, 'day').format('YYYY-MM-DD');
