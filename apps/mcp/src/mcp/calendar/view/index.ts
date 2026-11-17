import { inclusiveEndDate } from '../../time-input';

import type { AccessRole, Attendee, CalendarEvent, CalendarSummary, EventPage, EventTime, NextPage, Recurrence, TimeWindow, TimeZoneRef } from '@napolab/gct-core/calendar';

// Read side (.claude/rules/mcp-write-strict.md): tool output shaped for an LLM. Ids are always present, times keep
// their offsets, Google's noise (etag, colors, htmlLink) is dropped, and an event's `time` uses the same shape
// create_event / update_event accept, so a read → modify → write round trip needs no conversion.
// Output only, so absent values are `null` (wire format), not optional fields.

export type CalendarView = { readonly id: string; readonly summary: string; readonly primary: boolean; readonly accessRole: AccessRole; readonly timeZone: string | null };

export type EventTimeView =
  | { readonly kind: 'allDay'; readonly date: string; readonly endDate: string }
  | { readonly kind: 'timed'; readonly start: string; readonly end: string; readonly timeZone: string | null }
  // Google never mixes the kinds; kept so the mapping is total.
  | { readonly kind: 'mixed'; readonly start: EventTime; readonly end: EventTime };

export type RecurrenceView =
  | { readonly kind: 'single' }
  | { readonly kind: 'series'; readonly rules: readonly string[] }
  // One occurrence of a series. Updating / deleting it changes this occurrence only.
  | { readonly kind: 'instance'; readonly recurringEventId: string };

export type EventView =
  | {
      readonly id: string;
      readonly calendarId: string;
      readonly status: 'confirmed' | 'tentative';
      readonly summary: string;
      readonly description: string;
      readonly location: string;
      readonly time: EventTimeView;
      readonly attendees: readonly Attendee[];
      readonly recurrence: RecurrenceView;
      readonly updated: string;
    }
  | { readonly id: string; readonly calendarId: string; readonly status: 'cancelled'; readonly recurrence: RecurrenceView };

export type WindowView = { readonly from: string | null; readonly to: string | null };

export type EventPageView = {
  readonly calendarId: string;
  // The instants actually listed (list_events fills in its defaults); null = unbounded.
  readonly window: WindowView;
  readonly events: readonly EventView[];
  // Pass back as pageToken (with the same arguments) for more; null on the last page.
  readonly nextPageToken: string | null;
};

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

export const toCalendarView = (calendar: CalendarSummary): CalendarView => ({
  id: calendar.id,
  summary: calendar.summary,
  primary: calendar.primary,
  accessRole: calendar.accessRole,
  timeZone: zoneName(calendar.timeZone),
});

const toTimeView = (start: EventTime, end: EventTime): EventTimeView => {
  if (start.kind === 'date' && end.kind === 'date') return { kind: 'allDay', date: start.date, endDate: inclusiveEndDate(end.date) };
  if (start.kind === 'dateTime' && end.kind === 'dateTime') return { kind: 'timed', start: start.dateTime, end: end.dateTime, timeZone: zoneName(start.timeZone) };
  return { kind: 'mixed', start, end };
};

const toRecurrenceView = (recurrence: Recurrence): RecurrenceView => {
  switch (recurrence.kind) {
    case 'single':
      return recurrence;
    case 'series':
      return { kind: 'series', rules: recurrence.rules };
    case 'instance':
      return { kind: 'instance', recurringEventId: recurrence.recurringEventId };
    default: {
      const _exhaustive: never = recurrence;
      throw new Error(`unhandled recurrence: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const toEventView = (event: CalendarEvent): EventView => {
  switch (event.status) {
    case 'cancelled':
      return { id: event.id, calendarId: event.calendarId, status: 'cancelled', recurrence: toRecurrenceView(event.recurrence) };
    case 'confirmed':
    case 'tentative':
      return {
        id: event.id,
        calendarId: event.calendarId,
        status: event.status,
        summary: event.summary,
        description: event.description,
        location: event.location,
        time: toTimeView(event.start, event.end),
        attendees: event.attendees,
        recurrence: toRecurrenceView(event.recurrence),
        updated: event.updated,
      };
    default: {
      const _exhaustive: never = event;
      throw new Error(`unhandled event: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const nextPageToken = (nextPage: NextPage): string | null => {
  switch (nextPage.kind) {
    case 'none':
      return null;
    case 'next':
      return nextPage.pageToken;
    default: {
      const _exhaustive: never = nextPage;
      throw new Error(`unhandled next page: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toWindowView = (window: TimeWindow): WindowView => {
  switch (window.kind) {
    case 'all':
      return { from: null, to: null };
    case 'from':
      return { from: window.timeMin, to: null };
    case 'until':
      return { from: null, to: window.timeMax };
    case 'between':
      return { from: window.timeMin, to: window.timeMax };
    default: {
      const _exhaustive: never = window;
      throw new Error(`unhandled window: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export type ListedEvents = { readonly calendarId: string; readonly window: TimeWindow };

export const toEventPageView = (listed: ListedEvents, page: EventPage): EventPageView => ({
  calendarId: listed.calendarId,
  window: toWindowView(listed.window),
  events: page.events.map(toEventView),
  nextPageToken: nextPageToken(page.nextPage),
});
