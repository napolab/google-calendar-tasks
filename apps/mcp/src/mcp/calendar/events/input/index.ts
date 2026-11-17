import { dayjs } from '@napolab/gct-core/dayjs';
import { InvalidInputError } from '@napolab/gct-core/errors';
import { Result, err, ok } from 'neverthrow';
import { z } from 'zod';

import { TOOL_TIME_ZONE, nextDate, parseDate, parseDateTime, parseTimeZone, parseWindowBound, toWindowEnd, toWindowStart } from '../../../time-input';
import { PRIMARY_CALENDAR, calendarIdArg, calendarOf, requireNonEmpty, sendUpdatesArg, setOrKeep, toSendUpdates, toTextPatch } from '../../shared';

import type {
  AttendeeInput,
  ConferencePatch,
  ConferenceRequest,
  CreateEventInput,
  CreateEventType,
  DeleteEventInput,
  EventColor,
  EventDetails,
  EventRef,
  EventTime,
  FieldPatch,
  FreeBusyInput,
  ImportEventInput,
  ListEventInstancesInput,
  ListEventsInput,
  MoveEventInput,
  QuickAddEventInput,
  StatusEventType,
  TimePatch,
  TimeWindow,
  TimeZoneRef,
  UpdateEventInput,
  WorkingLocation,
} from '@napolab/gct-core/calendar';

// Event tool arguments (zod schemas the SDK advertises and validates) and their mapping to core inputs.
// The schemas check structure only; formats are checked here so the error names the argument, the value, the
// expected format and the fix (.claude/rules/mcp-write-strict.md). Pure: the clock and the id source are passed in.

const DEFAULT_WINDOW_DAYS = 7;

// A series is usually looked at further ahead than one week.
const DEFAULT_INSTANCES_WINDOW_DAYS = 90;

const DEFAULT_PAGE_SIZE = 50;

// Generates the unique id a conference create request needs (crypto.randomUUID at the handler).
export type NewRequestId = () => string;

// ---- schemas ----

const eventIdArg = z.string().min(1).describe('Event id from list_events.');

const windowBound = (edge: 'start' | 'end', fallback: string) =>
  z
    .string()
    .optional()
    .describe(
      `Window ${edge}: a date YYYY-MM-DD (a whole day in ${TOOL_TIME_ZONE}${edge === 'end' ? ', inclusive' : ''}) or RFC 3339 with offset (e.g. 2026-11-17T10:00:00+09:00). Default: ${fallback}.`,
    );

const maxResultsArg = z.number().int().min(1).max(2500).optional().describe(`Events per page, 1-2500. Default: ${DEFAULT_PAGE_SIZE}.`);

// Google behaviour seen on real events: guestsCanModify implies the other two, which Google then leaves out of the event.
export const GUESTS_MODIFY_NOTE =
  'When guestsCanModify is true, Google implies the other two permissions and omits guestsCanInviteOthers / guestsCanSeeOtherGuests from its response, so they read back as true.';
export const eventTimeArg = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('allDay'),
      date: z.string().describe('First day, YYYY-MM-DD.'),
      endDate: z.string().optional().describe('Last day, INCLUSIVE, YYYY-MM-DD. Omit for a one-day event.'),
    }),
    z.strictObject({
      kind: z.literal('timed'),
      start: z.string().describe('RFC 3339 with offset, e.g. 2026-11-17T10:00:00+09:00.'),
      end: z.string().describe('RFC 3339 with offset, after start.'),
      timeZone: z.string().optional().describe('IANA zone the event is anchored to, e.g. Asia/Tokyo. REQUIRED with recurrence. Omit to rely on the offsets.'),
    }),
  ])
  .describe("When the event happens: { kind: 'allDay', date, endDate? } or { kind: 'timed', start, end, timeZone? }.");

const attendeesArg = z.array(z.string()).describe('Required guests: email addresses.');

const optionalAttendeesArg = z.array(z.string()).describe('Optional guests: email addresses (marked optional in the invitation).');

const recurrenceArg = z
  .array(z.string().min(1))
  .min(1)
  .describe(
    'RFC 5545 lines, each starting with RRULE:, EXRULE:, RDATE or EXDATE, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"]. No DTSTART (the series starts at time). A timed series needs time.timeZone.',
  );

const reminderArg = z.strictObject({ method: z.enum(['email', 'popup']), minutes: z.number().int().min(0).max(40320).describe('Minutes before the start, 0-40320 (4 weeks).') });

const remindersArg = z
  .discriminatedUnion('kind', [z.strictObject({ kind: z.literal('default') }), z.strictObject({ kind: z.literal('custom'), overrides: z.array(reminderArg).max(5) })])
  .describe("{ kind: 'default' } = the calendar's default reminders; { kind: 'custom', overrides: [{ method: 'email' | 'popup', minutes }] } (at most 5; [] = no reminders).");

const colorIdArg = z.string().min(1).describe('Event color id "1"-"11" (get_colors lists them under event).');

const visibilityArg = z.enum(['default', 'public', 'private', 'confidential']).describe("Who sees the details: 'default' (the calendar's setting), 'public', 'private' or 'confidential'.");

const transparencyArg = z.enum(['opaque', 'transparent']).describe("'opaque' = busy (blocks time), 'transparent' = available.");

const autoDeclineArg = z.enum(['declineNone', 'declineAllConflictingInvitations', 'declineOnlyNewConflictingInvitations']);

const officeLocationShape = {
  label: z.string().optional().describe('Office name shown in Calendar.'),
  buildingId: z.string().optional(),
  floorId: z.string().optional(),
  floorSectionId: z.string().optional(),
  deskId: z.string().optional(),
};

const workingLocationArg = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('homeOffice') }),
  z.strictObject({ type: z.literal('officeLocation'), ...officeLocationShape }),
  z.strictObject({ type: z.literal('customLocation'), label: z.string().optional() }),
]);

// create_event: the type is fixed at creation; unset properties take documented neutral values.
const eventTypeArg = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('focusTime'),
      autoDeclineMode: autoDeclineArg.optional().describe("Default 'declineNone'."),
      declineMessage: z.string().optional(),
      chatStatus: z.enum(['available', 'doNotDisturb']).optional().describe("Default 'available'."),
    }),
    z.strictObject({ kind: z.literal('outOfOffice'), autoDeclineMode: autoDeclineArg.optional().describe("Default 'declineNone'."), declineMessage: z.string().optional() }),
    z.strictObject({ kind: z.literal('workingLocation'), location: workingLocationArg }),
  ])
  .describe(
    'Make a status event on the PRIMARY calendar: focusTime / outOfOffice (timed only, opaque) or workingLocation (public + transparent by default; all-day must be a single day). Omit for a normal event. Cannot be changed later.',
  );

// update_event: the properties replace the stored ones, so every setting is explicit.
const eventTypePropertiesArg = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('focusTime'), autoDeclineMode: autoDeclineArg, declineMessage: z.string().optional(), chatStatus: z.enum(['available', 'doNotDisturb']) }),
    z.strictObject({ kind: z.literal('outOfOffice'), autoDeclineMode: autoDeclineArg, declineMessage: z.string().optional() }),
    z.strictObject({ kind: z.literal('workingLocation'), location: workingLocationArg }),
  ])
  .describe("New properties of a focusTime / outOfOffice / workingLocation event (its kind must match the event's type, which cannot change).");

// The fields an event is made of (create_event and import_event).
const eventDetailsShape = {
  summary: z.string().describe('Event title (non-empty).'),
  time: eventTimeArg,
  calendarId: calendarIdArg,
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: attendeesArg.optional(),
  optionalAttendees: optionalAttendeesArg.optional(),
  recurrence: recurrenceArg.optional().describe(`${recurrenceArg.description ?? ''} Omit for a single event.`),
  reminders: remindersArg.optional().describe("Default: { kind: 'default' }."),
  colorId: colorIdArg.optional().describe("Default: the calendar's color."),
  visibility: visibilityArg.optional().describe("Default: 'default' ('public' for a workingLocation event)."),
  transparency: transparencyArg.optional().describe("Default: 'opaque' ('transparent' for a workingLocation event)."),
  guestsCanModify: z.boolean().optional().describe(`Guests may edit the event. Default false. ${GUESTS_MODIFY_NOTE}`),
  guestsCanInviteOthers: z.boolean().optional().describe(`Guests may invite others. Default true. ${GUESTS_MODIFY_NOTE}`),
  guestsCanSeeOtherGuests: z.boolean().optional().describe(`Guests see the guest list. Default true. ${GUESTS_MODIFY_NOTE}`),
};

export const listEventsArgs = z.strictObject({
  calendarId: calendarIdArg,
  from: windowBound('start', 'now'),
  to: windowBound('end', `${DEFAULT_WINDOW_DAYS} days after from`),
  query: z.string().optional().describe('Free-text search over summary, description, location and attendees.'),
  maxResults: maxResultsArg,
  pageToken: z.string().min(1).optional().describe('nextPageToken from the previous list_events call with the same arguments.'),
});

export const listEventInstancesArgs = z.strictObject({
  eventId: z.string().min(1).describe('Id of the recurring event (the series), e.g. recurrence.recurringEventId of an occurrence.'),
  calendarId: calendarIdArg,
  from: windowBound('start', 'now'),
  to: windowBound('end', `${DEFAULT_INSTANCES_WINDOW_DAYS} days after from`),
  maxResults: maxResultsArg,
  pageToken: z.string().min(1).optional().describe('nextPageToken from the previous list_event_instances call with the same arguments.'),
});

export const eventRefArgs = z.strictObject({ eventId: eventIdArg, calendarId: calendarIdArg });

export const deleteEventArgs = z.strictObject({ eventId: eventIdArg, calendarId: calendarIdArg, sendUpdates: sendUpdatesArg });

export const createEventArgs = z.strictObject({
  ...eventDetailsShape,
  addGoogleMeet: z.boolean().optional().describe('true creates a Google Meet link for the event.'),
  eventType: eventTypeArg.optional(),
  sendUpdates: sendUpdatesArg,
});

export const importEventArgs = z.strictObject({
  iCalUID: z.string().describe('The iCalendar UID of the event being imported (its UID: line).'),
  ...eventDetailsShape,
});

export const updateEventArgs = z.strictObject({
  eventId: eventIdArg,
  calendarId: calendarIdArg,
  summary: z.string().optional().describe('New title (non-empty). Omit to keep.'),
  description: z.string().optional().describe('New description. Omit to keep; use clearDescription to remove.'),
  clearDescription: z.boolean().optional().describe('true removes the description.'),
  location: z.string().optional().describe('New location. Omit to keep; use clearLocation to remove.'),
  clearLocation: z.boolean().optional().describe('true removes the location.'),
  attendees: attendeesArg.optional().describe('Required guests. attendees + optionalAttendees together REPLACE the whole guest list. Omit both to keep; clearAttendees removes all.'),
  optionalAttendees: optionalAttendeesArg.optional().describe('Optional guests; see attendees (passing only this drops the required guests).'),
  clearAttendees: z.boolean().optional().describe('true removes every guest.'),
  time: eventTimeArg.optional().describe('New time (start and end move together). Omit to keep.'),
  recurrence: recurrenceArg.optional().describe('Replaces every rule of the series. To end it, set an RRULE with UNTIL or COUNT. Omit to keep.'),
  reminders: remindersArg.optional().describe('New reminders. Omit to keep.'),
  colorId: colorIdArg.optional().describe('New event color. Omit to keep; clearColor returns to the calendar color.'),
  clearColor: z.boolean().optional().describe("true returns to the calendar's color."),
  visibility: visibilityArg.optional().describe('Omit to keep.'),
  transparency: transparencyArg.optional().describe('Omit to keep.'),
  guestsCanModify: z.boolean().optional().describe(`Omit to keep. ${GUESTS_MODIFY_NOTE}`),
  guestsCanInviteOthers: z.boolean().optional().describe(`Omit to keep. ${GUESTS_MODIFY_NOTE}`),
  guestsCanSeeOtherGuests: z.boolean().optional().describe(`Omit to keep. ${GUESTS_MODIFY_NOTE}`),
  addGoogleMeet: z.boolean().optional().describe('true adds a new Google Meet link.'),
  removeConference: z.boolean().optional().describe('true removes the Meet / conference from the event.'),
  eventTypeProperties: eventTypePropertiesArg.optional(),
  sendUpdates: sendUpdatesArg,
});

export const moveEventArgs = z.strictObject({
  eventId: eventIdArg,
  calendarId: calendarIdArg.describe("Calendar the event is on now. Default: 'primary'."),
  destination: z.string().min(1).describe('Id of the calendar to move the event to (from list_calendars).'),
  sendUpdates: sendUpdatesArg,
});

export const quickAddEventArgs = z.strictObject({
  text: z.string().describe('A sentence Google parses into an event, e.g. "Lunch with Ann at Cafe tomorrow 12pm-1pm".'),
  calendarId: calendarIdArg,
  sendUpdates: sendUpdatesArg,
});

export const freeBusyArgs = z.strictObject({
  from: z.string().describe(`Window start: YYYY-MM-DD (a whole day in ${TOOL_TIME_ZONE}) or RFC 3339 with offset.`),
  to: z.string().describe(`Window end: YYYY-MM-DD (inclusive day in ${TOOL_TIME_ZONE}) or RFC 3339 with offset.`),
  calendarIds: z.array(z.string().min(1)).min(1).max(50).optional().describe("Calendar ids to check, 1-50. Default: ['primary']."),
});

export type ListEventsArgs = z.output<typeof listEventsArgs>;
export type ListEventInstancesArgs = z.output<typeof listEventInstancesArgs>;
export type EventRefArgs = z.output<typeof eventRefArgs>;
export type DeleteEventArgs = z.output<typeof deleteEventArgs>;
export type EventTimeArg = z.output<typeof eventTimeArg>;
export type CreateEventArgs = z.output<typeof createEventArgs>;
export type ImportEventArgs = z.output<typeof importEventArgs>;
export type UpdateEventArgs = z.output<typeof updateEventArgs>;
export type MoveEventArgs = z.output<typeof moveEventArgs>;
export type QuickAddEventArgs = z.output<typeof quickAddEventArgs>;
export type FreeBusyArgs = z.output<typeof freeBusyArgs>;

type EventTypeArg = z.output<typeof eventTypeArg>;
type EventTypePropertiesArg = z.output<typeof eventTypePropertiesArg>;
type WorkingLocationArg = z.output<typeof workingLocationArg>;
type EventDetailsArgs = Pick<CreateEventArgs, keyof typeof eventDetailsShape>;

// ---- shared ----

const parseOptional = <T>(value: string | undefined, parse: (value: string) => Result<T, InvalidInputError>): Result<T | undefined, InvalidInputError> =>
  value === undefined ? ok(undefined) : parse(value);

const isAfter = (later: string, earlier: string): boolean => dayjs(later).isAfter(dayjs(earlier));

const requireOrder = (args: { readonly startArg: string; readonly start: string; readonly endArg: string; readonly end: string }): Result<void, InvalidInputError> => {
  if (isAfter(args.end, args.start)) return ok(undefined);
  return err(new InvalidInputError(`${args.endArg} "${args.end}" must be after ${args.startArg} "${args.start}". Pass a later ${args.endArg} (or an earlier ${args.startArg}).`));
};

const emailSchema = z.email();

const parseEmails = (arg: string, emails: readonly string[]): Result<readonly string[], InvalidInputError> => {
  const invalid = emails.filter((email) => !emailSchema.safeParse(email).success);
  if (invalid.length === 0) return ok(emails);
  return err(new InvalidInputError(`${arg} contains values that are not email addresses: ${invalid.map((email) => `"${email}"`).join(', ')}. Pass guest email addresses such as "name@example.com".`));
};

// Required and optional guests together; one address in both lists is ambiguous.
const parseGuests = (required: readonly string[], optional: readonly string[]): Result<readonly AttendeeInput[], InvalidInputError> =>
  parseEmails('attendees', required).andThen(() =>
    parseEmails('optionalAttendees', optional).andThen(() => {
      const both = required.filter((email) => optional.includes(email));
      if (both.length > 0)
        return err(new InvalidInputError(`${both.map((email) => `"${email}"`).join(', ')} is in both attendees and optionalAttendees. Put each guest in exactly one of the two lists.`));
      return ok([...required.map((email) => ({ email, optional: false })), ...optional.map((email) => ({ email, optional: true }))]);
    }),
  );

const exclusive = (args: { readonly a: string; readonly aSet: boolean; readonly b: string; readonly bSet: boolean }): Result<void, InvalidInputError> =>
  args.aSet && args.bSet ? err(new InvalidInputError(`Pass either ${args.a} or ${args.b}, not both.`)) : ok(undefined);

export const toEventRef = (args: EventRefArgs): EventRef => ({ ...calendarOf(args.calendarId), eventId: args.eventId });

export const toDeleteEventInput = (args: DeleteEventArgs): DeleteEventInput => ({ ...toEventRef(args), sendUpdates: toSendUpdates(args.sendUpdates) });

// ---- list ----

const nowInZone = (now: number): string => dayjs(now).tz(TOOL_TIME_ZONE).format();

const daysAfter = (timeMin: string, days: number): string => dayjs(timeMin).add(days, 'day').tz(TOOL_TIME_ZONE).format();

const toQuery = (query: string | undefined): Result<ListEventsInput['search'], InvalidInputError> => {
  if (query === undefined) return ok({ kind: 'none' });
  if (query.trim() === '') return err(new InvalidInputError('query is empty. Pass the text to search for, or omit query to list every event in the window.'));
  return ok({ kind: 'text', text: query });
};

// A window must end after it starts. The message shows what the caller passed and the instants it resolved to.
const requireWindowOrder = (window: { readonly from: string; readonly to: string; readonly timeMin: string; readonly timeMax: string }): Result<void, InvalidInputError> => {
  if (isAfter(window.timeMax, window.timeMin)) return ok(undefined);
  return err(
    new InvalidInputError(
      `to "${window.to}" (ends ${window.timeMax}) must be after from "${window.from}" (starts ${window.timeMin}). A date-only to is inclusive; pass a later to or an earlier from.`,
    ),
  );
};

type WindowArgs = { readonly from?: string | undefined; readonly to?: string | undefined };

const toWindow = (args: WindowArgs, now: number, defaultDays: number): Result<TimeWindow, InvalidInputError> =>
  parseOptional(args.from, (value) => parseWindowBound('from', value)).andThen((from) =>
    parseOptional(args.to, (value) => parseWindowBound('to', value)).andThen((to) => {
      const timeMin = from === undefined ? nowInZone(now) : toWindowStart(from);
      const timeMax = to === undefined ? daysAfter(timeMin, defaultDays) : toWindowEnd(to);
      return requireWindowOrder({ from: args.from ?? 'now', to: args.to ?? timeMax, timeMin, timeMax }).map((): TimeWindow => ({ kind: 'between', timeMin, timeMax }));
    }),
  );

const toPage = (pageToken: string | undefined): ListEventsInput['page'] => (pageToken === undefined ? { kind: 'first' } : { kind: 'next', pageToken });

export const toListEventsInput = (args: ListEventsArgs, now: number): Result<ListEventsInput, InvalidInputError> =>
  toWindow(args, now, DEFAULT_WINDOW_DAYS).andThen((window) =>
    toQuery(args.query).map((search): ListEventsInput => ({
      ...calendarOf(args.calendarId),
      window,
      search,
      maxResults: args.maxResults ?? DEFAULT_PAGE_SIZE,
      page: toPage(args.pageToken),
    })),
  );

export const toListEventInstancesInput = (args: ListEventInstancesArgs, now: number): Result<ListEventInstancesInput, InvalidInputError> =>
  toWindow(args, now, DEFAULT_INSTANCES_WINDOW_DAYS).map((window) => ({
    ...calendarOf(args.calendarId),
    eventId: args.eventId,
    window,
    maxResults: args.maxResults ?? DEFAULT_PAGE_SIZE,
    page: toPage(args.pageToken),
  }));

// ---- event time (create / update / import) ----

type EventRange = { readonly start: EventTime; readonly end: EventTime };

const toLastDay = (date: string, endDate: string | undefined): Result<string, InvalidInputError> => {
  if (endDate === undefined) return ok(date);
  return parseDate('time.endDate', endDate).andThen((last) =>
    dayjs.utc(last).isBefore(dayjs.utc(date))
      ? err(new InvalidInputError(`time.endDate "${last}" is before time.date "${date}". endDate is the INCLUSIVE last day; pass a date on or after time.date, or omit it for a one-day event.`))
      : ok(last),
  );
};

// endDate is the inclusive last day; Google's all-day end is the exclusive day after it.
const toAllDayRange = (date: string, endDate: string | undefined): Result<EventRange, InvalidInputError> =>
  parseDate('time.date', date).andThen((first) => toLastDay(first, endDate).map((last): EventRange => ({ start: { kind: 'date', date: first }, end: { kind: 'date', date: nextDate(last) } })));

const toZone = (timeZone: string | undefined): Result<TimeZoneRef, InvalidInputError> =>
  timeZone === undefined ? ok({ kind: 'none' }) : parseTimeZone('time.timeZone', timeZone).map((name): TimeZoneRef => ({ kind: 'iana', name }));

const toTimedRange = (time: Extract<EventTimeArg, { kind: 'timed' }>): Result<EventRange, InvalidInputError> =>
  parseDateTime('time.start', time.start).andThen((start) =>
    parseDateTime('time.end', time.end).andThen((end) =>
      requireOrder({ startArg: 'time.start', start, endArg: 'time.end', end }).andThen(() =>
        toZone(time.timeZone).map((timeZone): EventRange => ({ start: { kind: 'dateTime', dateTime: start, timeZone }, end: { kind: 'dateTime', dateTime: end, timeZone } })),
      ),
    ),
  );

const toEventRange = (time: EventTimeArg): Result<EventRange, InvalidInputError> => {
  switch (time.kind) {
    case 'allDay':
      return toAllDayRange(time.date, time.endDate);
    case 'timed':
      return toTimedRange(time);
    default: {
      const _exhaustive: never = time;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// ---- event type ----

const toOffice = (location: Extract<WorkingLocationArg, { type: 'officeLocation' }>): WorkingLocation => ({
  type: 'officeLocation',
  office: { label: location.label ?? '', buildingId: location.buildingId ?? '', floorId: location.floorId ?? '', floorSectionId: location.floorSectionId ?? '', deskId: location.deskId ?? '' },
});

const toWorkingLocation = (location: WorkingLocationArg): WorkingLocation => {
  switch (location.type) {
    case 'homeOffice':
      return { type: 'homeOffice' };
    case 'officeLocation':
      return toOffice(location);
    case 'customLocation':
      return { type: 'customLocation', label: location.label ?? '' };
    default: {
      const _exhaustive: never = location;
      throw new Error(`unhandled working location: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Unset focus time / out-of-office settings take the neutral values: no auto-decline, no message, chat available.
const toCreateEventType = (eventType: EventTypeArg | undefined): CreateEventType => {
  if (eventType === undefined) return { kind: 'default' };
  switch (eventType.kind) {
    case 'focusTime':
      return {
        kind: 'focusTime',
        properties: { autoDeclineMode: eventType.autoDeclineMode ?? 'declineNone', declineMessage: eventType.declineMessage ?? '', chatStatus: eventType.chatStatus ?? 'available' },
      };
    case 'outOfOffice':
      return { kind: 'outOfOffice', properties: { autoDeclineMode: eventType.autoDeclineMode ?? 'declineNone', declineMessage: eventType.declineMessage ?? '' } };
    case 'workingLocation':
      return { kind: 'workingLocation', location: toWorkingLocation(eventType.location) };
    default: {
      const _exhaustive: never = eventType;
      throw new Error(`unhandled event type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toStatusProperties = (properties: EventTypePropertiesArg): StatusEventType => {
  switch (properties.kind) {
    case 'focusTime':
      return { kind: 'focusTime', properties: { autoDeclineMode: properties.autoDeclineMode, declineMessage: properties.declineMessage ?? '', chatStatus: properties.chatStatus } };
    case 'outOfOffice':
      return { kind: 'outOfOffice', properties: { autoDeclineMode: properties.autoDeclineMode, declineMessage: properties.declineMessage ?? '' } };
    case 'workingLocation':
      return { kind: 'workingLocation', location: toWorkingLocation(properties.location) };
    default: {
      const _exhaustive: never = properties;
      throw new Error(`unhandled event type properties: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// A working location event must be public and transparent; those become its defaults (an explicit conflicting
// value still reaches core, which rejects it with the reason).
const isWorkingLocation = (eventType: CreateEventType): boolean => eventType.kind === 'workingLocation';

// ---- create / import ----

const requireSummary = (summary: string): Result<string, InvalidInputError> => (summary.trim() === '' ? err(new InvalidInputError('summary is empty. Pass the event title.')) : ok(summary));

const toColor = (colorId: string | undefined): EventColor => (colorId === undefined ? { kind: 'calendar' } : { kind: 'color', colorId });

const toEventDetails = (args: EventDetailsArgs, eventType: CreateEventType): Result<EventDetails, InvalidInputError> =>
  requireSummary(args.summary).andThen((summary) =>
    toEventRange(args.time).andThen((range) =>
      parseGuests(args.attendees ?? [], args.optionalAttendees ?? []).map((attendees): EventDetails => ({
        summary,
        description: args.description ?? '',
        location: args.location ?? '',
        ...range,
        attendees,
        recurrence: args.recurrence ?? [],
        reminders: args.reminders ?? { kind: 'default' },
        color: toColor(args.colorId),
        visibility: args.visibility ?? (isWorkingLocation(eventType) ? 'public' : 'default'),
        transparency: args.transparency ?? (isWorkingLocation(eventType) ? 'transparent' : 'opaque'),
        guests: { canModify: args.guestsCanModify ?? false, canInviteOthers: args.guestsCanInviteOthers ?? true, canSeeOtherGuests: args.guestsCanSeeOtherGuests ?? true },
      })),
    ),
  );

const toConferenceRequest = (addGoogleMeet: boolean | undefined, newRequestId: NewRequestId): ConferenceRequest =>
  addGoogleMeet === true ? { kind: 'meet', requestId: newRequestId() } : { kind: 'none' };

export const toCreateEventInput = (newRequestId: NewRequestId, args: CreateEventArgs): Result<CreateEventInput, InvalidInputError> => {
  const eventType = toCreateEventType(args.eventType);
  return toEventDetails(args, eventType).map((details): CreateEventInput => ({
    ...calendarOf(args.calendarId),
    ...details,
    eventType,
    conference: toConferenceRequest(args.addGoogleMeet, newRequestId),
    sendUpdates: toSendUpdates(args.sendUpdates),
  }));
};

export const toImportEventInput = (args: ImportEventArgs): Result<ImportEventInput, InvalidInputError> =>
  requireNonEmpty('iCalUID', args.iCalUID, 'Pass the iCalendar UID of the event (its UID: line), e.g. "abc123@example.com".').andThen((iCalUID) =>
    toEventDetails(args, { kind: 'default' }).map((details): ImportEventInput => ({ ...calendarOf(args.calendarId), iCalUID, ...details })),
  );

// ---- update ----

const toSummaryPatch = (summary: string | undefined): Result<FieldPatch<string>, InvalidInputError> =>
  summary === undefined ? ok({ kind: 'keep' }) : requireSummary(summary).map((value): FieldPatch<string> => ({ kind: 'set', value }));

// attendees / optionalAttendees together replace the list; clearAttendees empties it.
const toAttendeesPatch = (args: UpdateEventArgs): Result<FieldPatch<readonly AttendeeInput[]>, InvalidInputError> => {
  const given = args.attendees !== undefined || args.optionalAttendees !== undefined;
  const clear = args.clearAttendees === true;
  if (given && clear) return err(new InvalidInputError('Pass either attendees / optionalAttendees (to replace the guest list) or clearAttendees: true (to remove every guest), not both.'));
  if (clear) return ok({ kind: 'clear' });
  if (!given) return ok({ kind: 'keep' });
  const required = args.attendees ?? [];
  const optional = args.optionalAttendees ?? [];
  if (required.length + optional.length === 0) return err(new InvalidInputError('attendees is empty. Pass the guests to keep, or clearAttendees: true to remove every guest.'));
  return parseGuests(required, optional).map((value) => ({ kind: 'set', value }));
};

const toColorPatch = (args: UpdateEventArgs): Result<FieldPatch<string>, InvalidInputError> =>
  exclusive({ a: 'colorId', aSet: args.colorId !== undefined, b: 'clearColor', bSet: args.clearColor === true }).map((): FieldPatch<string> => {
    if (args.clearColor === true) return { kind: 'clear' };
    return setOrKeep(args.colorId);
  });

const toConferencePatch = (args: UpdateEventArgs, newRequestId: NewRequestId): Result<ConferencePatch, InvalidInputError> =>
  exclusive({ a: 'addGoogleMeet', aSet: args.addGoogleMeet === true, b: 'removeConference', bSet: args.removeConference === true }).map((): ConferencePatch => {
    if (args.addGoogleMeet === true) return { kind: 'createMeet', requestId: newRequestId() };
    if (args.removeConference === true) return { kind: 'remove' };
    return { kind: 'keep' };
  });

const toTimePatch = (time: EventTimeArg | undefined): Result<TimePatch, InvalidInputError> =>
  time === undefined ? ok({ kind: 'keep' }) : toEventRange(time).map((range): TimePatch => ({ kind: 'set', ...range }));

const UPDATABLE =
  'summary, description / clearDescription, location / clearLocation, attendees / optionalAttendees / clearAttendees, time, recurrence, reminders, colorId / clearColor, visibility, transparency, guestsCan*, addGoogleMeet / removeConference, eventTypeProperties';

const PATCH_FIELDS = [
  'summary',
  'description',
  'location',
  'attendees',
  'time',
  'recurrence',
  'reminders',
  'color',
  'visibility',
  'transparency',
  'guestsCanModify',
  'guestsCanInviteOthers',
  'guestsCanSeeOtherGuests',
  'conference',
  'statusProperties',
] as const satisfies readonly (keyof UpdateEventInput)[];

const requireChange = (input: UpdateEventInput): Result<UpdateEventInput, InvalidInputError> => {
  if (PATCH_FIELDS.some((field) => input[field].kind !== 'keep')) return ok(input);
  return err(new InvalidInputError(`Nothing to update for event "${input.eventId}": pass at least one of ${UPDATABLE}. Omitted fields are kept as they are.`));
};

export const toUpdateEventInput = (newRequestId: NewRequestId, args: UpdateEventArgs): Result<UpdateEventInput, InvalidInputError> =>
  Result.combine([
    toSummaryPatch(args.summary),
    toTextPatch({ field: 'description', clearArg: 'clearDescription', value: args.description, clear: args.clearDescription }),
    toTextPatch({ field: 'location', clearArg: 'clearLocation', value: args.location, clear: args.clearLocation }),
    toColorPatch(args),
  ]).andThen(([summary, description, location, color]) =>
    toAttendeesPatch(args).andThen((attendees) =>
      toConferencePatch(args, newRequestId).andThen((conference) =>
        toTimePatch(args.time)
          .map((time): UpdateEventInput => ({
            ...calendarOf(args.calendarId),
            eventId: args.eventId,
            summary,
            description,
            location,
            attendees,
            time,
            recurrence: setOrKeep(args.recurrence),
            reminders: setOrKeep(args.reminders),
            color,
            visibility: setOrKeep(args.visibility),
            transparency: setOrKeep(args.transparency),
            guestsCanModify: setOrKeep(args.guestsCanModify),
            guestsCanInviteOthers: setOrKeep(args.guestsCanInviteOthers),
            guestsCanSeeOtherGuests: setOrKeep(args.guestsCanSeeOtherGuests),
            conference,
            statusProperties: args.eventTypeProperties === undefined ? { kind: 'keep' } : { kind: 'set', value: toStatusProperties(args.eventTypeProperties) },
            sendUpdates: toSendUpdates(args.sendUpdates),
          }))
          .andThen(requireChange),
      ),
    ),
  );

// ---- move / quick add ----

export const toMoveEventInput = (args: MoveEventArgs): MoveEventInput => ({ ...toEventRef(args), destination: args.destination, sendUpdates: toSendUpdates(args.sendUpdates) });

export const toQuickAddEventInput = (args: QuickAddEventArgs): Result<QuickAddEventInput, InvalidInputError> =>
  requireNonEmpty('text', args.text, 'Pass a sentence describing the event, e.g. "Lunch with Ann tomorrow 12pm".').map((text) => ({
    ...calendarOf(args.calendarId),
    text,
    sendUpdates: toSendUpdates(args.sendUpdates),
  }));

// ---- free / busy ----

export const toFreeBusyInput = (args: FreeBusyArgs): Result<FreeBusyInput, InvalidInputError> =>
  parseWindowBound('from', args.from).andThen((from) =>
    parseWindowBound('to', args.to).andThen((to) => {
      const timeMin = toWindowStart(from);
      const timeMax = toWindowEnd(to);
      return requireWindowOrder({ from: args.from, to: args.to, timeMin, timeMax }).map(() => ({ timeMin, timeMax, calendarIds: args.calendarIds ?? [PRIMARY_CALENDAR] }));
    }),
  );
