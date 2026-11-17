import { z } from 'zod';

import type { BusyInterval, CalendarAvailability, CalendarColor, CalendarEvent, CalendarSummary, EventTime, FreeBusyResult, NextPage, Recurrence, TimeZoneRef } from './index';

// Google Calendar v3 wire shapes. Google omits fields freely or sends `null`; both are accepted
// here (.claude/rules/function-arg-types.md) and converted straight into the domain unions
// (.claude/rules/discriminated-unions.md), so nothing optional leaks past this file.

const toTimeZoneRef = (name: string | null | undefined): TimeZoneRef => (name === null || name === undefined ? { kind: 'none' } : { kind: 'iana', name });

const toCalendarColor = (hex: string | null | undefined): CalendarColor => (hex === null || hex === undefined ? { kind: 'none' } : { kind: 'hex', hex });

const toNextPage = (pageToken: string | null | undefined): NextPage => (pageToken === null || pageToken === undefined ? { kind: 'none' } : { kind: 'next', pageToken });

// ---- calendarList ----

export type CalendarListPage = { readonly items: readonly CalendarSummary[]; readonly nextPage: NextPage };

const calendarListEntrySchema = z
  .object({
    id: z.string(),
    summary: z.string().nullish(),
    summaryOverride: z.string().nullish(),
    primary: z.boolean().nullish(),
    accessRole: z.enum(['freeBusyReader', 'reader', 'writer', 'owner']),
    timeZone: z.string().nullish(),
    backgroundColor: z.string().nullish(),
  })
  .transform((entry): CalendarSummary => ({
    id: entry.id,
    summary: entry.summaryOverride ?? entry.summary ?? '',
    primary: entry.primary === true,
    accessRole: entry.accessRole,
    timeZone: toTimeZoneRef(entry.timeZone),
    backgroundColor: toCalendarColor(entry.backgroundColor),
  }));

export const calendarListPageSchema: z.ZodType<CalendarListPage> = z
  .object({ items: z.array(calendarListEntrySchema).nullish(), nextPageToken: z.string().nullish() })
  .transform((page) => ({ items: page.items ?? [], nextPage: toNextPage(page.nextPageToken) }));

// ---- events ----

// Google sends `{ dateTime, timeZone? }` for timed events and `{ date }` for all-day events.
const eventTimeSchema: z.ZodType<EventTime> = z.union([
  z.object({ dateTime: z.string(), timeZone: z.string().nullish() }).transform((time): EventTime => ({ kind: 'dateTime', dateTime: time.dateTime, timeZone: toTimeZoneRef(time.timeZone) })),
  z.object({ date: z.string() }).transform((time): EventTime => ({ kind: 'date', date: time.date })),
]);

const attendeeSchema = z
  .object({ email: z.string(), responseStatus: z.enum(['needsAction', 'declined', 'tentative', 'accepted']).nullish() })
  // Google's own default for an attendee who has not answered.
  .transform((attendee) => ({ email: attendee.email, responseStatus: attendee.responseStatus ?? 'needsAction' }));

const recurrenceWireSchema = z.object({
  recurrence: z.array(z.string()).nullish(),
  recurringEventId: z.string().nullish(),
  originalStartTime: eventTimeSchema.nullish(),
});

type RecurrenceWire = z.output<typeof recurrenceWireSchema>;

// An instance must say which series it belongs to and which slot it occupies; `undefined` = malformed.
const toRecurrence = (wire: RecurrenceWire): Recurrence | undefined => {
  if (wire.recurringEventId !== null && wire.recurringEventId !== undefined) {
    if (wire.originalStartTime === null || wire.originalStartTime === undefined) return undefined;
    return { kind: 'instance', recurringEventId: wire.recurringEventId, originalStartTime: wire.originalStartTime };
  }
  if (wire.recurrence !== null && wire.recurrence !== undefined && wire.recurrence.length > 0) return { kind: 'series', rules: wire.recurrence };
  return { kind: 'single' };
};

const MALFORMED_INSTANCE = 'a recurring event instance (recurringEventId) must carry originalStartTime';

// Distributes over the union: the event resource does not say which calendar it belongs to,
// so the service adds `calendarId` from the request.
type WithoutCalendarId<T> = T extends unknown ? Omit<T, 'calendarId'> : never;

export type GoogleEvent = WithoutCalendarId<CalendarEvent>;

const cancelledEventSchema = recurrenceWireSchema.extend({ id: z.string(), status: z.literal('cancelled') }).transform((event, ctx): GoogleEvent => {
  const recurrence = toRecurrence(event);
  if (recurrence === undefined) {
    ctx.addIssue({ code: 'custom', message: MALFORMED_INSTANCE });
    return z.NEVER;
  }
  return { status: 'cancelled', id: event.id, recurrence };
});

const activeEventSchema = recurrenceWireSchema
  .extend({
    id: z.string(),
    // Absent status means the event is confirmed.
    status: z.enum(['confirmed', 'tentative']).nullish(),
    // Empty for untitled events and for private events the caller can only see as busy.
    summary: z.string().nullish(),
    description: z.string().nullish(),
    location: z.string().nullish(),
    start: eventTimeSchema,
    end: eventTimeSchema,
    htmlLink: z.string().nullish(),
    attendees: z.array(attendeeSchema).nullish(),
    created: z.string().nullish(),
    updated: z.string().nullish(),
  })
  .transform((event, ctx): GoogleEvent => {
    const recurrence = toRecurrence(event);
    if (recurrence === undefined) {
      ctx.addIssue({ code: 'custom', message: MALFORMED_INSTANCE });
      return z.NEVER;
    }
    return {
      status: event.status ?? 'confirmed',
      id: event.id,
      summary: event.summary ?? '',
      description: event.description ?? '',
      location: event.location ?? '',
      start: event.start,
      end: event.end,
      htmlLink: event.htmlLink ?? '',
      attendees: event.attendees ?? [],
      recurrence,
      created: event.created ?? '',
      updated: event.updated ?? '',
    };
  });

export const eventSchema: z.ZodType<GoogleEvent> = z.union([cancelledEventSchema, activeEventSchema]);

export type EventListPage = { readonly items: readonly GoogleEvent[]; readonly nextPage: NextPage };

export const eventListPageSchema: z.ZodType<EventListPage> = z
  .object({ items: z.array(eventSchema).nullish(), nextPageToken: z.string().nullish() })
  .transform((page) => ({ items: page.items ?? [], nextPage: toNextPage(page.nextPageToken) }));

// ---- freeBusy ----

const busyIntervalSchema: z.ZodType<BusyInterval> = z.object({ start: z.string(), end: z.string() });

const calendarFreeBusySchema = z.object({
  busy: z.array(busyIntervalSchema).nullish(),
  // Per-calendar failures (e.g. `notFound`) arrive inside a 200 response.
  errors: z.array(z.object({ reason: z.string() })).nullish(),
});

const toAvailability = (calendarId: string, wire: z.output<typeof calendarFreeBusySchema>): CalendarAvailability => {
  const reasons = (wire.errors ?? []).map((error) => error.reason);
  if (reasons.length > 0) return { kind: 'error', calendarId, reasons };
  return { kind: 'ok', calendarId, busy: wire.busy ?? [] };
};

export const freeBusySchema: z.ZodType<FreeBusyResult> = z.object({ timeMin: z.string(), timeMax: z.string(), calendars: z.record(z.string(), calendarFreeBusySchema) }).transform((result) => ({
  timeMin: result.timeMin,
  timeMax: result.timeMax,
  calendars: Object.entries(result.calendars).map(([calendarId, wire]) => toAvailability(calendarId, wire)),
}));
