import { createEvent, deleteEvent, getEvent, importEvent, listEventInstances, listEvents, moveEvent, quickAddEvent, updateEvent } from './events';
import { deleteCalendarAclRule, getCalendarAclRule, insertCalendarAclRule, listCalendarAcl, updateCalendarAclRule } from './acl';
import { getCalendarListEntry, listCalendars, subscribeCalendar, unsubscribeCalendar, updateCalendarListEntry } from './calendar-list';
import { clearPrimaryCalendar, createCalendar, deleteCalendar, getCalendar, updateCalendar } from './calendars';
import { getColors } from './colors';
import { queryFreeBusy } from './freebusy';
import { getSetting, listSettings } from './settings';

import type { GoogleError, InvalidInputError } from '../errors';
import type { GoogleClient } from '../google-client';
import type { ResultAsync } from 'neverthrow';

// Google Calendar v3 service. Every state is its own variant (.claude/rules/discriminated-unions.md). The only
// optional field is the input-edge `calendarId` (see EventRef).

// ---- shared ----

// An IANA zone, or none. `none` is a real state: Google omits the zone on many events and the
// RFC 3339 offset alone pins the instant.
export type TimeZoneRef = { readonly kind: 'none' } | { readonly kind: 'iana'; readonly name: string };

// When an event happens. All-day and timed events are separate variants.
// - `date`: an all-day event, `YYYY-MM-DD`. Google treats the END date as EXCLUSIVE: a one-day
//   event on 2026-11-17 has start 2026-11-17 and end 2026-11-18.
// - `dateTime`: RFC 3339 with an explicit offset (`2026-11-17T10:00:00+09:00` / `...Z`).
//   `timeZone` is the IANA zone the event is anchored to (required by Google for recurring events).
export type EventTime = { readonly kind: 'date'; readonly date: string } | { readonly kind: 'dateTime'; readonly dateTime: string; readonly timeZone: TimeZoneRef };

// The page after this one: pass `{ kind: 'next', pageToken }` back as the input's `page`.
export type NextPage = { readonly kind: 'none' } | { readonly kind: 'next'; readonly pageToken: string };

export type PageRequest = { readonly kind: 'first' } | { readonly kind: 'next'; readonly pageToken: string };

export type FieldPatch<T> = { readonly kind: 'keep' } | { readonly kind: 'set'; readonly value: T } | { readonly kind: 'clear' };

// A field that can be changed but has no "empty" state to clear to.
export type SetPatch<T> = { readonly kind: 'keep' } | { readonly kind: 'set'; readonly value: T };

// Who Google emails about an event write. Always sent explicitly (Google's own default varies by method).
export type SendUpdates = 'none' | 'externalOnly' | 'all';

export type ReminderMethod = 'email' | 'popup';

// minutes: 0..40320 (4 weeks) before the start.
export type ReminderOverride = { readonly method: ReminderMethod; readonly minutes: number };

// ---- calendars (calendarList summary) ----

export type AccessRole = 'freeBusyReader' | 'reader' | 'writerWithoutPrivateAccess' | 'writer' | 'owner';

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

export type Attendee = { readonly email: string; readonly responseStatus: AttendeeResponseStatus; readonly optional: boolean };

// An attendee to invite. `optional: true` marks them as an optional guest.
export type AttendeeInput = { readonly email: string; readonly optional: boolean };

export type Recurrence =
  | { readonly kind: 'single' }
  // The recurring master event; `rules` are RRULE / EXRULE / RDATE / EXDATE lines.
  | { readonly kind: 'series'; readonly rules: readonly string[] }
  // One occurrence of a series; `originalStartTime` identifies its slot even if it was moved.
  | { readonly kind: 'instance'; readonly recurringEventId: string; readonly originalStartTime: EventTime };

// The calendar's default reminders, or this event's own list (empty = no reminders at all).
export type Reminders = { readonly kind: 'default' } | { readonly kind: 'custom'; readonly overrides: readonly ReminderOverride[] };

// The calendar's color, or one of the event palette ids from colors.get ("1".."11").
export type EventColor = { readonly kind: 'calendar' } | { readonly kind: 'color'; readonly colorId: string };

export type Visibility = 'default' | 'public' | 'private' | 'confidential';

// opaque = busy (blocks time), transparent = available.
export type Transparency = 'opaque' | 'transparent';

export type GuestPermissions = { readonly canModify: boolean; readonly canInviteOthers: boolean; readonly canSeeOtherGuests: boolean };

export type AutoDeclineMode = 'declineNone' | 'declineAllConflictingInvitations' | 'declineOnlyNewConflictingInvitations';

// '' declineMessage = none.
export type FocusTimeProperties = { readonly autoDeclineMode: AutoDeclineMode; readonly declineMessage: string; readonly chatStatus: 'available' | 'doNotDisturb' };

export type OutOfOfficeProperties = { readonly autoDeclineMode: AutoDeclineMode; readonly declineMessage: string };

// '' = not set.
export type OfficeLocation = { readonly label: string; readonly buildingId: string; readonly floorId: string; readonly floorSectionId: string; readonly deskId: string };

export type WorkingLocation = { readonly type: 'homeOffice' } | { readonly type: 'officeLocation'; readonly office: OfficeLocation } | { readonly type: 'customLocation'; readonly label: string };

// The "status" event types that carry their own properties. Primary calendar only.
export type StatusEventType =
  | { readonly kind: 'focusTime'; readonly properties: FocusTimeProperties }
  | { readonly kind: 'outOfOffice'; readonly properties: OutOfOfficeProperties }
  | { readonly kind: 'workingLocation'; readonly location: WorkingLocation };

// What Google reports. `unknown` = a working location event Google sent without its properties.
export type EventType =
  | { readonly kind: 'default' }
  | { readonly kind: 'birthday' }
  | { readonly kind: 'fromGmail' }
  | Exclude<StatusEventType, { readonly kind: 'workingLocation' }>
  | { readonly kind: 'workingLocation'; readonly location: WorkingLocation | { readonly type: 'unknown' } };

export type ConferenceEntryPoint = { readonly type: 'video' | 'phone' | 'sip' | 'more'; readonly uri: string; readonly label: string; readonly pin: string };

export type Conference =
  | { readonly kind: 'none' }
  // `pending` while Google is still creating it (entry points arrive later); '' = not reported.
  | {
      readonly kind: 'conference';
      readonly status: 'pending' | 'success' | 'failure';
      readonly conferenceId: string;
      readonly solution: string;
      readonly entryPoints: readonly ConferenceEntryPoint[];
    };

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
  readonly eventType: EventType;
  readonly reminders: Reminders;
  readonly color: EventColor;
  readonly visibility: Visibility;
  readonly transparency: Transparency;
  readonly guests: GuestPermissions;
  readonly conference: Conference;
  // The Meet link ('' when the event has none).
  readonly hangoutLink: string;
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

export type ListEventsInput = {
  readonly calendarId?: string;
  readonly window: TimeWindow;
  readonly search: EventSearch;
  // 1..2500 (Google's limit per page).
  readonly maxResults: number;
  readonly page: PageRequest;
};

// The occurrences of one recurring event (events.instances).
export type ListEventInstancesInput = {
  readonly calendarId?: string;
  readonly eventId: string;
  readonly window: TimeWindow;
  // 1..2500.
  readonly maxResults: number;
  readonly page: PageRequest;
};

export type EventPage = { readonly events: readonly CalendarEvent[]; readonly nextPage: NextPage };

// The fields an event is made of, shared by create and import.
export type EventDetails = {
  readonly summary: string;
  // '' / [] for none.
  readonly description: string;
  readonly location: string;
  // start and end must be the same kind; end must be after start.
  readonly start: EventTime;
  readonly end: EventTime;
  readonly attendees: readonly AttendeeInput[];
  // RRULE / EXRULE / RDATE / EXDATE lines; [] for a single event. A timed series needs start.timeZone.
  readonly recurrence: readonly string[];
  readonly reminders: Reminders;
  readonly color: EventColor;
  readonly visibility: Visibility;
  readonly transparency: Transparency;
  readonly guests: GuestPermissions;
};

// `requestId` must be unique per request (Google ignores a reused one).
export type ConferenceRequest = { readonly kind: 'none' } | { readonly kind: 'meet'; readonly requestId: string };

// The type an event is created as (it cannot change afterwards).
export type CreateEventType = { readonly kind: 'default' } | StatusEventType;

export type CreateEventInput = EventDetails & {
  readonly calendarId?: string;
  readonly eventType: CreateEventType;
  readonly conference: ConferenceRequest;
  readonly sendUpdates: SendUpdates;
};

// events.import: a private copy of an existing event identified by its iCalendar UID.
export type ImportEventInput = EventDetails & { readonly calendarId?: string; readonly iCalUID: string };

// start and end move together so their kind and order can always be checked.
export type TimePatch = { readonly kind: 'keep' } | { readonly kind: 'set'; readonly start: EventTime; readonly end: EventTime };

export type ConferencePatch = { readonly kind: 'keep' } | { readonly kind: 'createMeet'; readonly requestId: string } | { readonly kind: 'remove' };

export type UpdateEventInput = {
  readonly calendarId?: string;
  readonly eventId: string;
  readonly summary: FieldPatch<string>;
  readonly description: FieldPatch<string>;
  readonly location: FieldPatch<string>;
  readonly attendees: FieldPatch<readonly AttendeeInput[]>;
  readonly time: TimePatch;
  // Replaces every rule. To end a series, set an RRULE with UNTIL / COUNT.
  readonly recurrence: SetPatch<readonly string[]>;
  readonly reminders: SetPatch<Reminders>;
  // clear = back to the calendar's color.
  readonly color: FieldPatch<string>;
  readonly visibility: SetPatch<Visibility>;
  readonly transparency: SetPatch<Transparency>;
  readonly guestsCanModify: SetPatch<boolean>;
  readonly guestsCanInviteOthers: SetPatch<boolean>;
  readonly guestsCanSeeOtherGuests: SetPatch<boolean>;
  readonly conference: ConferencePatch;
  // The properties of a focusTime / outOfOffice / workingLocation event (its type itself cannot change).
  readonly statusProperties: SetPatch<StatusEventType>;
  readonly sendUpdates: SendUpdates;
};

export type DeleteEventInput = EventRef & { readonly sendUpdates: SendUpdates };

// events.move: change the organizer calendar of an event (default events only).
export type MoveEventInput = EventRef & { readonly destination: string; readonly sendUpdates: SendUpdates };

// events.quickAdd: Google parses the text ("Lunch with Ann tomorrow 12pm").
export type QuickAddEventInput = { readonly calendarId?: string; readonly text: string; readonly sendUpdates: SendUpdates };

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

// ---- calendars (calendar metadata) ----

// Set only for secondary calendars.
export type DataOwner = { readonly kind: 'none' } | { readonly kind: 'email'; readonly email: string };

export type Calendar = {
  readonly id: string;
  readonly summary: string;
  // '' when not set.
  readonly description: string;
  readonly location: string;
  readonly timeZone: TimeZoneRef;
  readonly dataOwner: DataOwner;
};

export type CalendarRef = { readonly calendarId?: string };

// calendars.insert: a new secondary calendar owned by the user. '' / { kind: 'none' } = not set.
export type CreateCalendarInput = { readonly summary: string; readonly description: string; readonly location: string; readonly timeZone: TimeZoneRef };

export type UpdateCalendarInput = {
  readonly calendarId?: string;
  readonly summary: SetPatch<string>;
  readonly description: FieldPatch<string>;
  readonly location: FieldPatch<string>;
  // An IANA zone name.
  readonly timeZone: SetPatch<string>;
};

// Deleting has no 'primary' default: the id is always explicit (and 'primary' is rejected; Google cannot delete it).
export type DeleteCalendarInput = { readonly calendarId: string };

// ---- calendarList (the user's subscriptions and how they are displayed) ----

export type CalendarNotificationType = 'eventCreation' | 'eventChange' | 'eventCancellation' | 'eventResponse' | 'agenda';

export type CalendarListEntry = {
  readonly id: string;
  // The calendar's own title, and the user's name for it ('' when not overridden).
  readonly summary: string;
  readonly summaryOverride: string;
  readonly description: string;
  readonly location: string;
  readonly timeZone: TimeZoneRef;
  readonly accessRole: AccessRole;
  readonly primary: boolean;
  readonly hidden: boolean;
  readonly selected: boolean;
  // Calendar palette id from colors.get ('' when not set).
  readonly colorId: string;
  readonly backgroundColor: CalendarColor;
  readonly foregroundColor: CalendarColor;
  readonly defaultReminders: readonly ReminderOverride[];
  // Email notifications the user gets for this calendar.
  readonly notifications: readonly CalendarNotificationType[];
};

// The calendar palette (colors.get `calendar` ids), or explicit #RRGGBB colors.
export type ListEntryColor = { readonly kind: 'palette'; readonly colorId: string } | { readonly kind: 'rgb'; readonly background: string; readonly foreground: string };

// calendarList.insert: add an existing calendar (shared with the user, public, ...) to the list.
export type SubscribeCalendarInput = { readonly calendarId: string; readonly color: { readonly kind: 'default' } | ListEntryColor };

export type UpdateCalendarListEntryInput = {
  readonly calendarId?: string;
  readonly summaryOverride: FieldPatch<string>;
  readonly color: SetPatch<ListEntryColor>;
  readonly hidden: SetPatch<boolean>;
  readonly selected: SetPatch<boolean>;
  // [] = no default reminders.
  readonly defaultReminders: SetPatch<readonly ReminderOverride[]>;
  // [] = no email notifications.
  readonly notifications: SetPatch<readonly CalendarNotificationType[]>;
};

// No 'primary' default: the primary calendar cannot be removed from the list.
export type UnsubscribeCalendarInput = { readonly calendarId: string };

// ---- acl (sharing) ----

export type AclRole = 'none' | 'freeBusyReader' | 'reader' | 'writerWithoutPrivateAccess' | 'writer' | 'owner';

// Who a rule applies to: everyone (public), one user, a group, or a whole domain.
export type AclScope =
  | { readonly type: 'default' }
  | { readonly type: 'user'; readonly email: string }
  | { readonly type: 'group'; readonly email: string }
  | { readonly type: 'domain'; readonly domain: string };

export type AclRule = { readonly id: string; readonly role: AclRole; readonly scope: AclScope };

export type AclPage = { readonly rules: readonly AclRule[]; readonly nextPage: NextPage };

export type ListCalendarAclInput = {
  readonly calendarId?: string;
  // 1..250.
  readonly maxResults: number;
  readonly page: PageRequest;
};

export type AclRuleRef = { readonly calendarId?: string; readonly ruleId: string };

// `sendNotifications` is always explicit (Google's own default is to email the grantee).
export type InsertAclRuleInput = { readonly calendarId?: string; readonly scope: AclScope; readonly role: AclRole; readonly sendNotifications: boolean };

export type UpdateAclRuleInput = AclRuleRef & { readonly role: AclRole; readonly sendNotifications: boolean };

// ---- colors / settings ----

export type ColorDefinition = { readonly id: string; readonly background: string; readonly foreground: string };

// `calendar` ids are for calendar list entries, `event` ids for events. Ordered by id.
export type ColorPalettes = { readonly calendar: readonly ColorDefinition[]; readonly event: readonly ColorDefinition[] };

// A user setting; the value format depends on the id (e.g. timezone → "Asia/Tokyo", weekStart → "0").
export type Setting = { readonly id: string; readonly value: string };

export type SettingRef = { readonly settingId: string };

// ---- service ----

export interface ICalendarService {
  listCalendars(): ResultAsync<readonly CalendarSummary[], GoogleError>;
  listEvents(input: ListEventsInput): ResultAsync<EventPage, GoogleError | InvalidInputError>;
  listEventInstances(input: ListEventInstancesInput): ResultAsync<EventPage, GoogleError | InvalidInputError>;
  getEvent(input: EventRef): ResultAsync<CalendarEvent, GoogleError>;
  createEvent(input: CreateEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError>;
  updateEvent(input: UpdateEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError>;
  deleteEvent(input: DeleteEventInput): ResultAsync<void, GoogleError>;
  moveEvent(input: MoveEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError>;
  quickAddEvent(input: QuickAddEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError>;
  importEvent(input: ImportEventInput): ResultAsync<CalendarEvent, GoogleError | InvalidInputError>;
  queryFreeBusy(input: FreeBusyInput): ResultAsync<FreeBusyResult, GoogleError | InvalidInputError>;
  getCalendar(input: CalendarRef): ResultAsync<Calendar, GoogleError>;
  createCalendar(input: CreateCalendarInput): ResultAsync<Calendar, GoogleError | InvalidInputError>;
  updateCalendar(input: UpdateCalendarInput): ResultAsync<Calendar, GoogleError | InvalidInputError>;
  deleteCalendar(input: DeleteCalendarInput): ResultAsync<void, GoogleError | InvalidInputError>;
  // Deletes EVERY event of the primary calendar.
  clearPrimaryCalendar(): ResultAsync<void, GoogleError>;
  getCalendarListEntry(input: CalendarRef): ResultAsync<CalendarListEntry, GoogleError>;
  subscribeCalendar(input: SubscribeCalendarInput): ResultAsync<CalendarListEntry, GoogleError | InvalidInputError>;
  updateCalendarListEntry(input: UpdateCalendarListEntryInput): ResultAsync<CalendarListEntry, GoogleError | InvalidInputError>;
  unsubscribeCalendar(input: UnsubscribeCalendarInput): ResultAsync<void, GoogleError | InvalidInputError>;
  listCalendarAcl(input: ListCalendarAclInput): ResultAsync<AclPage, GoogleError | InvalidInputError>;
  getCalendarAclRule(input: AclRuleRef): ResultAsync<AclRule, GoogleError>;
  insertCalendarAclRule(input: InsertAclRuleInput): ResultAsync<AclRule, GoogleError | InvalidInputError>;
  updateCalendarAclRule(input: UpdateAclRuleInput): ResultAsync<AclRule, GoogleError>;
  deleteCalendarAclRule(input: AclRuleRef): ResultAsync<void, GoogleError>;
  getColors(): ResultAsync<ColorPalettes, GoogleError>;
  listSettings(): ResultAsync<readonly Setting[], GoogleError>;
  getSetting(input: SettingRef): ResultAsync<Setting, GoogleError | InvalidInputError>;
}

export type CalendarServiceDeps = { readonly client: GoogleClient };

// Each method delegates to its resource module's `(client, input)` function.
export const createCalendarService = ({ client }: CalendarServiceDeps): ICalendarService => ({
  listCalendars: () => listCalendars(client),
  listEvents: (input) => listEvents(client, input),
  listEventInstances: (input) => listEventInstances(client, input),
  getEvent: (input) => getEvent(client, input),
  createEvent: (input) => createEvent(client, input),
  updateEvent: (input) => updateEvent(client, input),
  deleteEvent: (input) => deleteEvent(client, input),
  moveEvent: (input) => moveEvent(client, input),
  quickAddEvent: (input) => quickAddEvent(client, input),
  importEvent: (input) => importEvent(client, input),
  queryFreeBusy: (input) => queryFreeBusy(client, input),
  getCalendar: (input) => getCalendar(client, input),
  createCalendar: (input) => createCalendar(client, input),
  updateCalendar: (input) => updateCalendar(client, input),
  deleteCalendar: (input) => deleteCalendar(client, input),
  clearPrimaryCalendar: () => clearPrimaryCalendar(client),
  getCalendarListEntry: (input) => getCalendarListEntry(client, input),
  subscribeCalendar: (input) => subscribeCalendar(client, input),
  updateCalendarListEntry: (input) => updateCalendarListEntry(client, input),
  unsubscribeCalendar: (input) => unsubscribeCalendar(client, input),
  listCalendarAcl: (input) => listCalendarAcl(client, input),
  getCalendarAclRule: (input) => getCalendarAclRule(client, input),
  insertCalendarAclRule: (input) => insertCalendarAclRule(client, input),
  updateCalendarAclRule: (input) => updateCalendarAclRule(client, input),
  deleteCalendarAclRule: (input) => deleteCalendarAclRule(client, input),
  getColors: () => getColors(client),
  listSettings: () => listSettings(client),
  getSetting: (input) => getSetting(client, input),
});
