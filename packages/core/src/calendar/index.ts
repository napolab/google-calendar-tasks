import { okAsync } from 'neverthrow';
import { z } from 'zod';

import { calendarListPageSchema, eventListPageSchema, eventSchema, freeBusySchema } from './schemas';
import { validateEventRange, validateEventUpdate, validateFreeBusy, validateMaxResults, validateSearch, validateTimeWindow } from './validation';

import type { GoogleEvent } from './schemas';

import type { GoogleError, InvalidInputError } from '../errors';
import type { GoogleClient } from '../google-client';
import type { ResultAsync } from 'neverthrow';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

const PRIMARY_CALENDAR = 'primary';

// Every state is its own variant (.claude/rules/discriminated-unions.md). The only optional field
// is the input-edge `calendarId` (see EventRef).

// ---- shared ----

// An IANA zone, or none. `none` is a real state: Google omits the zone on many events and the
// RFC 3339 offset alone pins the instant.
export type TimeZoneRef = { readonly kind: 'none' } | { readonly kind: 'iana'; readonly name: string };

// When an event happens. All-day and timed events are separate variants.
// - `date`: an all-day event, `YYYY-MM-DD`. Google treats the END date as EXCLUSIVE: a one-day
//   event on 2026-11-17 has start 2026-11-17 and end 2026-11-18.
// - `dateTime`: RFC 3339 with an explicit offset (`2026-11-17T10:00:00+09:00` / `...Z`).
//   `timeZone` is the IANA zone the event is anchored to (matters for recurring events).
export type EventTime = { readonly kind: 'date'; readonly date: string } | { readonly kind: 'dateTime'; readonly dateTime: string; readonly timeZone: TimeZoneRef };

// The page after this one: pass `{ kind: 'next', pageToken }` back as ListEventsInput.page.
export type NextPage = { readonly kind: 'none' } | { readonly kind: 'next'; readonly pageToken: string };

// ---- calendars ----

export type AccessRole = 'freeBusyReader' | 'reader' | 'writer' | 'owner';

export type CalendarColor = { readonly kind: 'none' } | { readonly kind: 'hex'; readonly hex: string };

export type CalendarSummary = {
  readonly id: string;
  // The user's own name for the calendar (summaryOverride) when set.
  readonly summary: string;
  readonly primary: boolean;
  readonly accessRole: AccessRole;
  readonly timeZone: TimeZoneRef;
  readonly backgroundColor: CalendarColor;
};

// ---- events ----

export type AttendeeResponseStatus = 'needsAction' | 'declined' | 'tentative' | 'accepted';

export type Attendee = { readonly email: string; readonly responseStatus: AttendeeResponseStatus };

export type Recurrence =
  | { readonly kind: 'single' }
  // The recurring master event; `rules` are RRULE / EXRULE / RDATE / EXDATE lines.
  | { readonly kind: 'series'; readonly rules: readonly string[] }
  // One occurrence of a series; `originalStartTime` identifies its slot even if it was moved.
  | { readonly kind: 'instance'; readonly recurringEventId: string; readonly originalStartTime: EventTime };

export type ActiveEvent = {
  readonly status: 'confirmed' | 'tentative';
  readonly id: string;
  readonly calendarId: string;
  // Empty strings / list when Google has no value (untitled, no description, ...).
  readonly summary: string;
  readonly description: string;
  readonly location: string;
  readonly start: EventTime;
  readonly end: EventTime;
  readonly htmlLink: string;
  readonly attendees: readonly Attendee[];
  readonly recurrence: Recurrence;
  readonly created: string;
  readonly updated: string;
};

// A cancelled event (or a cancelled occurrence of a series) only identifies what was cancelled.
export type CancelledEvent = {
  readonly status: 'cancelled';
  readonly id: string;
  readonly calendarId: string;
  readonly recurrence: Recurrence;
};

export type CalendarEvent = ActiveEvent | CancelledEvent;

// `calendarId` is the one optional field: it is an outermost input-edge argument whose default is
// Google's own alias 'primary' (itself a valid calendar id). A `{ kind: 'primary' } | { kind: 'id' }`
// union would give the same calendar two spellings, so a defaulted string is the canonical model.
export type EventRef = { readonly calendarId?: string; readonly eventId: string };

export type TimeWindow =
  | { readonly kind: 'all' }
  // RFC 3339 with offset. Events ending after timeMin.
  | { readonly kind: 'from'; readonly timeMin: string }
  // RFC 3339 with offset. Events starting before timeMax.
  | { readonly kind: 'until'; readonly timeMax: string }
  | { readonly kind: 'between'; readonly timeMin: string; readonly timeMax: string };

// Free-text search over summary, description, location, attendees (Google's `q`).
export type EventSearch = { readonly kind: 'none' } | { readonly kind: 'text'; readonly text: string };

export type PageRequest = { readonly kind: 'first' } | { readonly kind: 'next'; readonly pageToken: string };

export type ListEventsInput = {
  readonly calendarId?: string;
  readonly window: TimeWindow;
  readonly search: EventSearch;
  // 1..2500 (Google's limit per page).
  readonly maxResults: number;
  readonly page: PageRequest;
};

export type EventPage = { readonly events: readonly CalendarEvent[]; readonly nextPage: NextPage };

export type CreateEventInput = {
  readonly calendarId?: string;
  readonly summary: string;
  // '' / [] for none.
  readonly description: string;
  readonly location: string;
  // start and end must be the same kind; end must be after start.
  readonly start: EventTime;
  readonly end: EventTime;
  // Attendee email addresses.
  readonly attendees: readonly string[];
};

export type FieldPatch<T> = { readonly kind: 'keep' } | { readonly kind: 'set'; readonly value: T } | { readonly kind: 'clear' };

// start and end move together so their kind and order can always be checked.
export type TimePatch = { readonly kind: 'keep' } | { readonly kind: 'set'; readonly start: EventTime; readonly end: EventTime };

export type UpdateEventInput = {
  readonly calendarId?: string;
  readonly eventId: string;
  readonly summary: FieldPatch<string>;
  readonly description: FieldPatch<string>;
  readonly location: FieldPatch<string>;
  readonly attendees: FieldPatch<readonly string[]>;
  readonly time: TimePatch;
};

// ---- free / busy ----

export type FreeBusyInput = {
  // RFC 3339 with offset; timeMin must be before timeMax.
  readonly timeMin: string;
  readonly timeMax: string;
  // 1..50 calendar ids ('primary' for your own).
  readonly calendarIds: readonly string[];
};

export type BusyInterval = { readonly start: string; readonly end: string };

export type CalendarAvailability =
  | { readonly kind: 'ok'; readonly calendarId: string; readonly busy: readonly BusyInterval[] }
  // Google could not answer for this calendar (e.g. `notFound`); the rest of the result is valid.
  | { readonly kind: 'error'; readonly calendarId: string; readonly reasons: readonly string[] };

export type FreeBusyResult = { readonly timeMin: string; readonly timeMax: string; readonly calendars: readonly CalendarAvailability[] };

export interface ICalendarService {
  listCalendars(): ResultAsync<readonly CalendarSummary[], GoogleError>;
  listEvents(input: ListEventsInput): ResultAsync<EventPage, GoogleError | InvalidInputError>;
  getEvent(input: EventRef): ResultAsync<CalendarEvent, GoogleError>;
  createEvent(input: CreateEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError>;
  updateEvent(input: UpdateEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError>;
  deleteEvent(input: EventRef): ResultAsync<void, GoogleError>;
  queryFreeBusy(input: FreeBusyInput): ResultAsync<FreeBusyResult, GoogleError | InvalidInputError>;
}

export type CalendarServiceDeps = { readonly client: GoogleClient };

// ---- request building ----

const calendarIdOf = (input: { readonly calendarId?: string }): string => input.calendarId ?? PRIMARY_CALENDAR;

// Calendar ids look like `ja.japanese#holiday@group.v.calendar.google.com`, so every path segment is encoded.
const eventsURL = (calendarId: string): string => `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`;

const eventURL = (calendarId: string, eventId: string): string => `${eventsURL(calendarId)}/${encodeURIComponent(eventId)}`;

const withCalendarId =
  (calendarId: string) =>
  (event: GoogleEvent): CalendarEvent => ({ ...event, calendarId });

const zoneName = (zone: TimeZoneRef): string | null => {
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

// Request bodies go through JSON.stringify: `undefined` fields are not sent, `null` clears a field.
type CreateTimeBody = { readonly date: string } | { readonly dateTime: string; readonly timeZone: string | undefined };

const toCreateTime = (time: EventTime): CreateTimeBody => {
  switch (time.kind) {
    case 'date':
      return { date: time.date };
    case 'dateTime':
      return { dateTime: time.dateTime, timeZone: zoneName(time.timeZone) ?? undefined };
    default: {
      const _exhaustive: never = time;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// PATCH merges nested objects, so switching between all-day and timed must null the other
// variant's fields or Google keeps both and rejects the event.
// A timed patch sends the zone only when one is named: `none` leaves the stored zone alone
// (the offset already pins the instant, and recurring series need a zone).
type PatchTimeBody = { readonly date: string; readonly dateTime: null; readonly timeZone: null } | { readonly dateTime: string; readonly timeZone: string | undefined; readonly date: null };

const toPatchTime = (time: EventTime): PatchTimeBody => {
  switch (time.kind) {
    case 'date':
      return { date: time.date, dateTime: null, timeZone: null };
    case 'dateTime':
      return { dateTime: time.dateTime, timeZone: zoneName(time.timeZone) ?? undefined, date: null };
    default: {
      const _exhaustive: never = time;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type AttendeeBody = { readonly email: string };

const toAttendees = (emails: readonly string[]): readonly AttendeeBody[] => emails.map((email) => ({ email }));

const toCreateBody = (input: CreateEventInput) => ({
  summary: input.summary,
  description: input.description,
  location: input.location,
  start: toCreateTime(input.start),
  end: toCreateTime(input.end),
  attendees: toAttendees(input.attendees),
});

// keep → not sent; clear → Google's empty value.
const patchText = (patch: FieldPatch<string>): string | undefined => {
  switch (patch.kind) {
    case 'keep':
      return undefined;
    case 'set':
      return patch.value;
    case 'clear':
      return '';
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const patchAttendees = (patch: FieldPatch<readonly string[]>): readonly AttendeeBody[] | undefined => {
  switch (patch.kind) {
    case 'keep':
      return undefined;
    case 'set':
      return toAttendees(patch.value);
    case 'clear':
      return [];
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type TimePatchBody = { readonly start: PatchTimeBody | undefined; readonly end: PatchTimeBody | undefined };

const patchTime = (patch: TimePatch): TimePatchBody => {
  switch (patch.kind) {
    case 'keep':
      return { start: undefined, end: undefined };
    case 'set':
      return { start: toPatchTime(patch.start), end: toPatchTime(patch.end) };
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled time patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toPatchBody = (input: UpdateEventInput) => ({
  summary: patchText(input.summary),
  description: patchText(input.description),
  location: patchText(input.location),
  attendees: patchAttendees(input.attendees),
  ...patchTime(input.time),
});

type WindowQuery = { readonly timeMin: string | undefined; readonly timeMax: string | undefined };

const windowQuery = (window: TimeWindow): WindowQuery => {
  switch (window.kind) {
    case 'all':
      return { timeMin: undefined, timeMax: undefined };
    case 'from':
      return { timeMin: window.timeMin, timeMax: undefined };
    case 'until':
      return { timeMin: undefined, timeMax: window.timeMax };
    case 'between':
      return { timeMin: window.timeMin, timeMax: window.timeMax };
    default: {
      const _exhaustive: never = window;
      throw new Error(`unhandled window: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const searchQuery = (search: EventSearch): string | undefined => {
  switch (search.kind) {
    case 'none':
      return undefined;
    case 'text':
      return search.text;
    default: {
      const _exhaustive: never = search;
      throw new Error(`unhandled search: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const pageQuery = (page: PageRequest): string | undefined => {
  switch (page.kind) {
    case 'first':
      return undefined;
    case 'next':
      return page.pageToken;
    default: {
      const _exhaustive: never = page;
      throw new Error(`unhandled page: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// ---- service ----

// Walks every page of the calendar list, accumulating entries until there is no next page.
const listCalendarsFrom = (client: GoogleClient, page: PageRequest, collected: readonly CalendarSummary[]): ResultAsync<readonly CalendarSummary[], GoogleError> =>
  client.request({ method: 'GET', url: `${BASE_URL}/users/me/calendarList`, query: { maxResults: 250, pageToken: pageQuery(page) }, schema: calendarListPageSchema }).andThen((result) => {
    const calendars = [...collected, ...result.items];
    switch (result.nextPage.kind) {
      case 'none':
        return okAsync(calendars);
      case 'next':
        return listCalendarsFrom(client, result.nextPage, calendars);
      default: {
        const _exhaustive: never = result.nextPage;
        throw new Error(`unhandled page: ${JSON.stringify(_exhaustive)}`);
      }
    }
  });

const listEvents = (client: GoogleClient, input: ListEventsInput): ResultAsync<EventPage, GoogleError | InvalidInputError> => {
  const calendarId = calendarIdOf(input);
  return validateTimeWindow(input.window)
    .andThen(() => validateSearch(input.search))
    .andThen(() => validateMaxResults(input.maxResults))
    .asyncAndThen(() =>
      client.request({
        method: 'GET',
        url: eventsURL(calendarId),
        // singleEvents expands recurring events into instances, which orderBy=startTime requires.
        query: { singleEvents: true, orderBy: 'startTime', ...windowQuery(input.window), q: searchQuery(input.search), maxResults: input.maxResults, pageToken: pageQuery(input.page) },
        schema: eventListPageSchema,
      }),
    )
    .map((page) => ({ events: page.items.map(withCalendarId(calendarId)), nextPage: page.nextPage }));
};

export const createCalendarService = ({ client }: CalendarServiceDeps): ICalendarService => ({
  listCalendars: () => listCalendarsFrom(client, { kind: 'first' }, []),
  listEvents: (input) => listEvents(client, input),
  getEvent: (input) => {
    const calendarId = calendarIdOf(input);
    return client.request({ method: 'GET', url: eventURL(calendarId, input.eventId), schema: eventSchema }).map(withCalendarId(calendarId));
  },
  createEvent: (input) => {
    const calendarId = calendarIdOf(input);
    return validateEventRange(input)
      .asyncAndThen(() => client.request({ method: 'POST', url: eventsURL(calendarId), body: toCreateBody(input), schema: eventSchema }))
      .map(withCalendarId(calendarId));
  },
  updateEvent: (input) => {
    const calendarId = calendarIdOf(input);
    return validateEventUpdate(input)
      .asyncAndThen(() => client.request({ method: 'PATCH', url: eventURL(calendarId, input.eventId), body: toPatchBody(input), schema: eventSchema }))
      .map(withCalendarId(calendarId));
  },
  deleteEvent: (input) => client.request({ method: 'DELETE', url: eventURL(calendarIdOf(input), input.eventId), schema: z.undefined() }).map(() => undefined),
  queryFreeBusy: (input) =>
    validateFreeBusy(input).asyncAndThen(() =>
      client.request({
        method: 'POST',
        url: `${BASE_URL}/freeBusy`,
        body: { timeMin: input.timeMin, timeMax: input.timeMax, items: input.calendarIds.map((id) => ({ id })) },
        schema: freeBusySchema,
      }),
    ),
});
