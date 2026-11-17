import { calendarIdOf, eventURL, eventsURL, pageQuery, sendUpdatesQuery } from '../request';
import { emptySchema } from '../schemas';
import { validateMaxResults, validateSearch, validateTimeWindow } from '../validation';
import { eventListPageSchema, eventSchema } from './schemas';
import { validateCreateEvent, validateEventUpdate, validateImportEvent, validateMove, validateQuickAdd } from './validation';

import type { GoogleError, InvalidInputError } from '../../errors';
import type { GoogleClient } from '../../google-client';
import type {
  AttendeeInput,
  CalendarEvent,
  ConferencePatch,
  ConferenceRequest,
  CreateEventInput,
  CreateEventType,
  DeleteEventInput,
  EventColor,
  EventDetails,
  EventPage,
  EventRef,
  EventSearch,
  EventTime,
  FieldPatch,
  ImportEventInput,
  ListEventInstancesInput,
  ListEventsInput,
  MoveEventInput,
  OfficeLocation,
  QuickAddEventInput,
  ReminderOverride,
  Reminders,
  SetPatch,
  StatusEventType,
  TimePatch,
  TimeWindow,
  TimeZoneRef,
  UpdateEventInput,
  WorkingLocation,
} from '../index';
import type { GoogleEvent } from './schemas';
import type { ResultAsync } from 'neverthrow';

// events.*: each operation validates its input, then sends one request.

// Event request bodies. They go through JSON.stringify: `undefined` fields are not sent, `null` clears a field.

const zoneName = (zone: TimeZoneRef): string | undefined => {
  switch (zone.kind) {
    case 'none':
      return undefined;
    case 'iana':
      return zone.name;
    default: {
      const _exhaustive: never = zone;
      throw new Error(`unhandled time zone: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type CreateTimeBody = { readonly date: string } | { readonly dateTime: string; readonly timeZone: string | undefined };

const toCreateTime = (time: EventTime): CreateTimeBody => {
  switch (time.kind) {
    case 'date':
      return { date: time.date };
    case 'dateTime':
      return { dateTime: time.dateTime, timeZone: zoneName(time.timeZone) };
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
      return { dateTime: time.dateTime, timeZone: zoneName(time.timeZone), date: null };
    default: {
      const _exhaustive: never = time;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type AttendeeBody = { readonly email: string; readonly optional: boolean };

const toAttendees = (attendees: readonly AttendeeInput[]): readonly AttendeeBody[] => attendees.map((attendee) => ({ email: attendee.email, optional: attendee.optional }));

type RemindersBody = { readonly useDefault: true; readonly overrides: readonly [] | undefined } | { readonly useDefault: false; readonly overrides: readonly ReminderOverride[] };

// `emptyOverrides` is for PATCH: Google merges `reminders`, so going back to the default must also drop the old overrides.
const toReminders = (reminders: Reminders, emptyOverrides: boolean): RemindersBody => {
  switch (reminders.kind) {
    case 'default':
      return { useDefault: true, overrides: emptyOverrides ? [] : undefined };
    case 'custom':
      return { useDefault: false, overrides: reminders.overrides.map((override) => ({ method: override.method, minutes: override.minutes })) };
    default: {
      const _exhaustive: never = reminders;
      throw new Error(`unhandled reminders: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toColorId = (color: EventColor): string | undefined => {
  switch (color.kind) {
    case 'calendar':
      return undefined;
    case 'color':
      return color.colorId;
    default: {
      const _exhaustive: never = color;
      throw new Error(`unhandled color: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const meetRequest = (requestId: string) => ({ createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } });

type ConferenceBody = ReturnType<typeof meetRequest>;

const toConferenceData = (conference: ConferenceRequest): ConferenceBody | undefined => {
  switch (conference.kind) {
    case 'none':
      return undefined;
    case 'meet':
      return meetRequest(conference.requestId);
    default: {
      const _exhaustive: never = conference;
      throw new Error(`unhandled conference: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const patchConferenceData = (conference: ConferencePatch): ConferenceBody | null | undefined => {
  switch (conference.kind) {
    case 'keep':
      return undefined;
    case 'createMeet':
      return meetRequest(conference.requestId);
    case 'remove':
      return null;
    default: {
      const _exhaustive: never = conference;
      throw new Error(`unhandled conference patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// '' means "not set" for every free-text property, so it is not sent.
const textOrUndefined = (value: string): string | undefined => (value === '' ? undefined : value);

const toOfficeLocation = (office: OfficeLocation) => ({
  label: textOrUndefined(office.label),
  buildingId: textOrUndefined(office.buildingId),
  floorId: textOrUndefined(office.floorId),
  floorSectionId: textOrUndefined(office.floorSectionId),
  deskId: textOrUndefined(office.deskId),
});

const toWorkingLocation = (location: WorkingLocation) => {
  switch (location.type) {
    case 'homeOffice':
      // Google: "Any value; its presence indicates the user is working from home."
      return { type: location.type, homeOffice: {} };
    case 'officeLocation':
      return { type: location.type, officeLocation: toOfficeLocation(location.office) };
    case 'customLocation':
      return { type: location.type, customLocation: { label: textOrUndefined(location.label) } };
    default: {
      const _exhaustive: never = location;
      throw new Error(`unhandled working location: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// The type-specific property object of a status event.
const toStatusProperties = (status: StatusEventType) => {
  switch (status.kind) {
    case 'focusTime':
      return {
        focusTimeProperties: { autoDeclineMode: status.properties.autoDeclineMode, declineMessage: textOrUndefined(status.properties.declineMessage), chatStatus: status.properties.chatStatus },
      };
    case 'outOfOffice':
      return { outOfOfficeProperties: { autoDeclineMode: status.properties.autoDeclineMode, declineMessage: textOrUndefined(status.properties.declineMessage) } };
    case 'workingLocation':
      return { workingLocationProperties: toWorkingLocation(status.location) };
    default: {
      const _exhaustive: never = status;
      throw new Error(`unhandled status event type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// PATCH merges nested objects, so a properties patch spells everything out: the decline message is sent even when
// empty (to replace the stored one), and switching a working location's type nulls the other variants' objects.
const NO_LOCATION_VARIANTS = { homeOffice: null, officeLocation: null, customLocation: null };

const patchStatusProperties = (status: StatusEventType) => {
  switch (status.kind) {
    case 'focusTime':
      return { focusTimeProperties: { autoDeclineMode: status.properties.autoDeclineMode, declineMessage: status.properties.declineMessage, chatStatus: status.properties.chatStatus } };
    case 'outOfOffice':
      return { outOfOfficeProperties: { autoDeclineMode: status.properties.autoDeclineMode, declineMessage: status.properties.declineMessage } };
    case 'workingLocation':
      return { workingLocationProperties: { ...NO_LOCATION_VARIANTS, ...toWorkingLocation(status.location) } };
    default: {
      const _exhaustive: never = status;
      throw new Error(`unhandled status event type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toEventTypeBody = (eventType: CreateEventType) => {
  switch (eventType.kind) {
    case 'default':
      return {};
    case 'focusTime':
    case 'outOfOffice':
    case 'workingLocation':
      return { eventType: eventType.kind, ...toStatusProperties(eventType) };
    default: {
      const _exhaustive: never = eventType;
      throw new Error(`unhandled event type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toDetailsBody = (details: EventDetails) => ({
  summary: details.summary,
  description: details.description,
  location: details.location,
  start: toCreateTime(details.start),
  end: toCreateTime(details.end),
  attendees: toAttendees(details.attendees),
  // A single event has no recurrence field at all.
  recurrence: details.recurrence.length === 0 ? undefined : details.recurrence,
  reminders: toReminders(details.reminders, false),
  colorId: toColorId(details.color),
  visibility: details.visibility,
  transparency: details.transparency,
  guestsCanModify: details.guests.canModify,
  guestsCanInviteOthers: details.guests.canInviteOthers,
  guestsCanSeeOtherGuests: details.guests.canSeeOtherGuests,
});

const toCreateBody = (input: CreateEventInput) => ({ ...toDetailsBody(input), conferenceData: toConferenceData(input.conference), ...toEventTypeBody(input.eventType) });

const toImportBody = (input: ImportEventInput) => ({ iCalUID: input.iCalUID, ...toDetailsBody(input) });

// ---- patch ----

const patchValue = <T, R>(patch: SetPatch<T>, toBody: (value: T) => R): R | undefined => {
  switch (patch.kind) {
    case 'keep':
      return undefined;
    case 'set':
      return toBody(patch.value);
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const identity = <T>(value: T): T => value;

// keep → not sent; clear → `cleared` (Google's empty value for that field).
const patchClearable = <T, R, C>(patch: FieldPatch<T>, toBody: (value: T) => R, cleared: C): R | C | undefined => {
  switch (patch.kind) {
    case 'keep':
      return undefined;
    case 'set':
      return toBody(patch.value);
    case 'clear':
      return cleared;
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
  summary: patchClearable(input.summary, identity, ''),
  description: patchClearable(input.description, identity, ''),
  location: patchClearable(input.location, identity, ''),
  attendees: patchClearable(input.attendees, toAttendees, []),
  ...patchTime(input.time),
  recurrence: patchValue(input.recurrence, identity),
  reminders: patchValue(input.reminders, (reminders) => toReminders(reminders, true)),
  // null drops the event color, falling back to the calendar's.
  colorId: patchClearable(input.color, identity, null),
  visibility: patchValue(input.visibility, identity),
  transparency: patchValue(input.transparency, identity),
  guestsCanModify: patchValue(input.guestsCanModify, identity),
  guestsCanInviteOthers: patchValue(input.guestsCanInviteOthers, identity),
  guestsCanSeeOtherGuests: patchValue(input.guestsCanSeeOtherGuests, identity),
  conferenceData: patchConferenceData(input.conference),
  ...patchValue(input.statusProperties, patchStatusProperties),
});

// ---- operations ----

const withCalendarId =
  (calendarId: string) =>
  (event: GoogleEvent): CalendarEvent => ({ ...event, calendarId });

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

// conferenceDataVersion=1 is sent only when the body touches conferenceData (version 0 ignores it).
const conferenceVersion = (conference: ConferenceRequest | ConferencePatch): 1 | undefined => {
  switch (conference.kind) {
    case 'none':
    case 'keep':
      return undefined;
    case 'meet':
    case 'createMeet':
    case 'remove':
      return 1;
    default: {
      const _exhaustive: never = conference;
      throw new Error(`unhandled conference: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const listEvents = (client: GoogleClient, input: ListEventsInput): ResultAsync<EventPage, GoogleError | InvalidInputError> => {
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

export const listEventInstances = (client: GoogleClient, input: ListEventInstancesInput): ResultAsync<EventPage, GoogleError | InvalidInputError> => {
  const calendarId = calendarIdOf(input);
  return validateTimeWindow(input.window)
    .andThen(() => validateMaxResults(input.maxResults))
    .asyncAndThen(() =>
      client.request({
        method: 'GET',
        url: `${eventURL(calendarId, input.eventId)}/instances`,
        query: { ...windowQuery(input.window), maxResults: input.maxResults, pageToken: pageQuery(input.page) },
        schema: eventListPageSchema,
      }),
    )
    .map((page) => ({ events: page.items.map(withCalendarId(calendarId)), nextPage: page.nextPage }));
};

export const getEvent = (client: GoogleClient, input: EventRef): ResultAsync<CalendarEvent, GoogleError> => {
  const calendarId = calendarIdOf(input);
  return client.request({ method: 'GET', url: eventURL(calendarId, input.eventId), schema: eventSchema }).map(withCalendarId(calendarId));
};

export const createEvent = (client: GoogleClient, input: CreateEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError> => {
  const calendarId = calendarIdOf(input);
  return validateCreateEvent(input)
    .asyncAndThen(() =>
      client.request({
        method: 'POST',
        url: eventsURL(calendarId),
        query: { ...sendUpdatesQuery(input.sendUpdates), conferenceDataVersion: conferenceVersion(input.conference) },
        body: toCreateBody(input),
        schema: eventSchema,
      }),
    )
    .map(withCalendarId(calendarId));
};

export const updateEvent = (client: GoogleClient, input: UpdateEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError> => {
  const calendarId = calendarIdOf(input);
  return validateEventUpdate(input)
    .asyncAndThen(() =>
      client.request({
        method: 'PATCH',
        url: eventURL(calendarId, input.eventId),
        query: { ...sendUpdatesQuery(input.sendUpdates), conferenceDataVersion: conferenceVersion(input.conference) },
        body: toPatchBody(input),
        schema: eventSchema,
      }),
    )
    .map(withCalendarId(calendarId));
};

export const deleteEvent = (client: GoogleClient, input: DeleteEventInput): ResultAsync<void, GoogleError> =>
  client.request({ method: 'DELETE', url: eventURL(calendarIdOf(input), input.eventId), query: sendUpdatesQuery(input.sendUpdates), schema: emptySchema }).map(() => undefined);

export const moveEvent = (client: GoogleClient, input: MoveEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError> =>
  validateMove(input)
    .asyncAndThen(() =>
      client.request({
        method: 'POST',
        url: `${eventURL(calendarIdOf(input), input.eventId)}/move`,
        query: { destination: input.destination, ...sendUpdatesQuery(input.sendUpdates) },
        schema: eventSchema,
      }),
    )
    .map(withCalendarId(input.destination));

export const quickAddEvent = (client: GoogleClient, input: QuickAddEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError> => {
  const calendarId = calendarIdOf(input);
  return validateQuickAdd(input)
    .asyncAndThen(() => client.request({ method: 'POST', url: `${eventsURL(calendarId)}/quickAdd`, query: { text: input.text, ...sendUpdatesQuery(input.sendUpdates) }, schema: eventSchema }))
    .map(withCalendarId(calendarId));
};

export const importEvent = (client: GoogleClient, input: ImportEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError> => {
  const calendarId = calendarIdOf(input);
  return validateImportEvent(input)
    .asyncAndThen(() => client.request({ method: 'POST', url: `${eventsURL(calendarId)}/import`, body: toImportBody(input), schema: eventSchema }))
    .map(withCalendarId(calendarId));
};
