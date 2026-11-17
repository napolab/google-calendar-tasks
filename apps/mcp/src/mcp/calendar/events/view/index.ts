import { inclusiveEndDate } from '../../../time-input';
import { nextPageToken, zoneName } from '../../shared';

import type {
  AccessRole,
  Attendee,
  AutoDeclineMode,
  CalendarEvent,
  CalendarSummary,
  Conference,
  ConferenceEntryPoint,
  EventColor,
  EventPage,
  EventTime,
  EventType,
  Recurrence,
  Reminders,
  TimeWindow,
  Transparency,
  Visibility,
  WorkingLocation,
} from '@napolab/gct-core/calendar';

// Read side (.claude/rules/mcp-write-strict.md): tool output shaped for an LLM. Ids are always present, times keep
// their offsets, Google's noise (etag, htmlLink) is dropped, and an event's `time` / `eventType` use the same shape
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

export type WorkingLocationView =
  | { readonly type: 'homeOffice' }
  | {
      readonly type: 'officeLocation';
      readonly label: string | null;
      readonly buildingId: string | null;
      readonly floorId: string | null;
      readonly floorSectionId: string | null;
      readonly deskId: string | null;
    }
  | { readonly type: 'customLocation'; readonly label: string | null };

export type EventTypeView =
  | { readonly kind: 'default' }
  | { readonly kind: 'birthday' }
  | { readonly kind: 'fromGmail' }
  | { readonly kind: 'focusTime'; readonly autoDeclineMode: AutoDeclineMode; readonly declineMessage: string | null; readonly chatStatus: 'available' | 'doNotDisturb' }
  | { readonly kind: 'outOfOffice'; readonly autoDeclineMode: AutoDeclineMode; readonly declineMessage: string | null }
  // null = Google sent no location details.
  | { readonly kind: 'workingLocation'; readonly location: WorkingLocationView | null };

export type EntryPointView = { readonly type: ConferenceEntryPoint['type']; readonly uri: string; readonly label: string | null; readonly pin: string | null };

export type ConferenceView = {
  // pending: Google is still creating the Meet; get_event again shortly for the link.
  readonly status: 'pending' | 'success' | 'failure';
  readonly conferenceId: string | null;
  readonly solution: string | null;
  readonly entryPoints: readonly EntryPointView[];
};

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
      readonly eventType: EventTypeView;
      readonly reminders: Reminders;
      // null = the calendar's color.
      readonly colorId: string | null;
      readonly visibility: Visibility;
      readonly transparency: Transparency;
      readonly guestsCanModify: boolean;
      readonly guestsCanInviteOthers: boolean;
      readonly guestsCanSeeOtherGuests: boolean;
      // The Google Meet link; null when the event has none.
      readonly hangoutLink: string | null;
      readonly conference: ConferenceView | null;
      // The iCalendar UID (import_event's iCalUID); null when Google sent none.
      readonly iCalUID: string | null;
      readonly updated: string;
    }
  // Google still answers 200 for a deleted event (and a list can carry cancelled occurrences of a series), so the
  // stub says in words what `cancelled` means.
  | { readonly id: string; readonly calendarId: string; readonly status: 'cancelled'; readonly deleted: true; readonly recurrence: RecurrenceView; readonly note: string };

export type WindowView = { readonly from: string | null; readonly to: string | null };

export type EventPageView = {
  readonly calendarId: string;
  // The instants actually listed (list_events fills in its defaults); null = unbounded.
  readonly window: WindowView;
  readonly events: readonly EventView[];
  // Pass back as pageToken (with the same arguments) for more; null on the last page.
  readonly nextPageToken: string | null;
};

const textOrNull = (value: string): string | null => (value === '' ? null : value);

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

const toWorkingLocationView = (location: WorkingLocation | { readonly type: 'unknown' }): WorkingLocationView | null => {
  switch (location.type) {
    case 'unknown':
      return null;
    case 'homeOffice':
      return { type: 'homeOffice' };
    case 'officeLocation':
      return {
        type: 'officeLocation',
        label: textOrNull(location.office.label),
        buildingId: textOrNull(location.office.buildingId),
        floorId: textOrNull(location.office.floorId),
        floorSectionId: textOrNull(location.office.floorSectionId),
        deskId: textOrNull(location.office.deskId),
      };
    case 'customLocation':
      return { type: 'customLocation', label: textOrNull(location.label) };
    default: {
      const _exhaustive: never = location;
      throw new Error(`unhandled working location: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toEventTypeView = (eventType: EventType): EventTypeView => {
  switch (eventType.kind) {
    case 'default':
    case 'birthday':
    case 'fromGmail':
      return { kind: eventType.kind };
    case 'focusTime':
      return { kind: 'focusTime', autoDeclineMode: eventType.properties.autoDeclineMode, declineMessage: textOrNull(eventType.properties.declineMessage), chatStatus: eventType.properties.chatStatus };
    case 'outOfOffice':
      return { kind: 'outOfOffice', autoDeclineMode: eventType.properties.autoDeclineMode, declineMessage: textOrNull(eventType.properties.declineMessage) };
    case 'workingLocation':
      return { kind: 'workingLocation', location: toWorkingLocationView(eventType.location) };
    default: {
      const _exhaustive: never = eventType;
      throw new Error(`unhandled event type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toColorId = (color: EventColor): string | null => {
  switch (color.kind) {
    case 'calendar':
      return null;
    case 'color':
      return color.colorId;
    default: {
      const _exhaustive: never = color;
      throw new Error(`unhandled color: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toConferenceView = (conference: Conference): ConferenceView | null => {
  switch (conference.kind) {
    case 'none':
      return null;
    case 'conference':
      return {
        status: conference.status,
        conferenceId: textOrNull(conference.conferenceId),
        solution: textOrNull(conference.solution),
        entryPoints: conference.entryPoints.map((entry) => ({ type: entry.type, uri: entry.uri, label: textOrNull(entry.label), pin: textOrNull(entry.pin) })),
      };
    default: {
      const _exhaustive: never = conference;
      throw new Error(`unhandled conference: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const cancelledNote = (recurrence: Recurrence): string => {
  switch (recurrence.kind) {
    case 'single':
      return 'This event was deleted. It no longer appears on the calendar; only its id remains.';
    case 'series':
      return 'This recurring event was deleted, with every occurrence. It no longer appears on the calendar; only its id remains.';
    case 'instance':
      return 'This occurrence of a recurring series was cancelled (deleted); the rest of the series (recurringEventId) is unchanged.';
    default: {
      const _exhaustive: never = recurrence;
      throw new Error(`unhandled recurrence: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const toEventView = (event: CalendarEvent): EventView => {
  switch (event.status) {
    case 'cancelled':
      return { id: event.id, calendarId: event.calendarId, status: 'cancelled', deleted: true, recurrence: toRecurrenceView(event.recurrence), note: cancelledNote(event.recurrence) };
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
        eventType: toEventTypeView(event.eventType),
        reminders: event.reminders,
        colorId: toColorId(event.color),
        visibility: event.visibility,
        transparency: event.transparency,
        guestsCanModify: event.guests.canModify,
        guestsCanInviteOthers: event.guests.canInviteOthers,
        guestsCanSeeOtherGuests: event.guests.canSeeOtherGuests,
        hangoutLink: textOrNull(event.hangoutLink),
        conference: toConferenceView(event.conference),
        iCalUID: textOrNull(event.iCalUID),
        updated: event.updated,
      };
    default: {
      const _exhaustive: never = event;
      throw new Error(`unhandled event: ${JSON.stringify(_exhaustive)}`);
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
