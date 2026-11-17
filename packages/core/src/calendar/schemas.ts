import { z } from 'zod';

import type { EventTime, NextPage, ReminderOverride, TimeZoneRef } from './index';

// Wire helpers shared by the calendar resource schemas. Google omits fields freely or sends `null`; both are
// accepted (.claude/rules/function-arg-types.md) and converted straight into the domain unions
// (.claude/rules/discriminated-unions.md), so nothing optional leaks past the schema files.

export const toTimeZoneRef = (name: string | null | undefined): TimeZoneRef => (name === null || name === undefined ? { kind: 'none' } : { kind: 'iana', name });

export const toNextPage = (pageToken: string | null | undefined): NextPage => (pageToken === null || pageToken === undefined ? { kind: 'none' } : { kind: 'next', pageToken });

// Google sends `{ dateTime, timeZone? }` for timed events and `{ date }` for all-day events.
export const eventTimeSchema: z.ZodType<EventTime> = z.union([
  z.object({ dateTime: z.string(), timeZone: z.string().nullish() }).transform((time): EventTime => ({ kind: 'dateTime', dateTime: time.dateTime, timeZone: toTimeZoneRef(time.timeZone) })),
  z.object({ date: z.string() }).transform((time): EventTime => ({ kind: 'date', date: time.date })),
]);

export const reminderOverrideSchema: z.ZodType<ReminderOverride> = z.object({ method: z.enum(['email', 'popup']), minutes: z.number() });

// A response with no body (204 / empty), e.g. DELETE.
export const emptySchema: z.ZodUndefined = z.undefined();
