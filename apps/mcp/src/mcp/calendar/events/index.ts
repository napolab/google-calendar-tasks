import { ok, toToolError } from '../../tool-result';
import { ADDITIVE, DESTRUCTIVE, IDEMPOTENT_UPDATE, NOTIFY_NOTE, PRIMARY_CALENDAR, READ_ONLY } from '../shared';
import {
  GUESTS_MODIFY_NOTE,
  createEventArgs,
  deleteEventArgs,
  eventRefArgs,
  freeBusyArgs,
  importEventArgs,
  listEventInstancesArgs,
  listEventsArgs,
  moveEventArgs,
  quickAddEventArgs,
  toCreateEventInput,
  toDeleteEventInput,
  toEventRef,
  toFreeBusyInput,
  toImportEventInput,
  toListEventInstancesInput,
  toListEventsInput,
  toMoveEventInput,
  toQuickAddEventInput,
  toUpdateEventInput,
  updateEventArgs,
} from './input';
import { toCalendarView, toEventPageView, toEventView } from './view';

import type { ToolDeps } from '../../tool-deps';
import type { ToolResult } from '../../tool-result';
import type { CreateEventArgs, DeleteEventArgs, EventRefArgs, FreeBusyArgs, ImportEventArgs, ListEventInstancesArgs, ListEventsArgs, MoveEventArgs, QuickAddEventArgs, UpdateEventArgs } from './input';
import type { McpServer } from '@modelcontextprotocol/server';

// Event tools (and list_calendars / query_freebusy, which serve event planning). Each handler: arguments → core input
// (./input, validated before any Google call) → service call → normalized view (./view) → ToolResult (the single
// .match edge).

// Every conference create request needs a fresh id; Workers and Node both provide Web Crypto.
const newRequestId = (): string => crypto.randomUUID();

export const createEventToolHandlers = (deps: ToolDeps) => {
  const { calendar } = deps.services;
  const fail = toToolError(deps.connectURL, 'events');

  return {
    listCalendars: (): Promise<ToolResult> =>
      calendar
        .listCalendars()
        .map((calendars) => ({ calendars: calendars.map(toCalendarView) }))
        .match(ok, fail),

    listEvents: (args: ListEventsArgs): Promise<ToolResult> =>
      toListEventsInput(args, deps.now())
        .asyncAndThen((input) => calendar.listEvents(input).map((page) => toEventPageView({ calendarId: input.calendarId ?? PRIMARY_CALENDAR, window: input.window }, page)))
        .match(ok, fail),

    listEventInstances: (args: ListEventInstancesArgs): Promise<ToolResult> =>
      toListEventInstancesInput(args, deps.now())
        .asyncAndThen((input) =>
          calendar.listEventInstances(input).map((page) => ({ recurringEventId: input.eventId, ...toEventPageView({ calendarId: input.calendarId ?? PRIMARY_CALENDAR, window: input.window }, page) })),
        )
        .match(ok, fail),

    getEvent: (args: EventRefArgs): Promise<ToolResult> => calendar.getEvent(toEventRef(args)).map(toEventView).match(ok, fail),

    createEvent: (args: CreateEventArgs): Promise<ToolResult> =>
      toCreateEventInput(newRequestId, args)
        .asyncAndThen((input) => calendar.createEvent(input))
        .map(toEventView)
        .match(ok, fail),

    updateEvent: (args: UpdateEventArgs): Promise<ToolResult> =>
      toUpdateEventInput(newRequestId, args)
        .asyncAndThen((input) => calendar.updateEvent(input))
        .map(toEventView)
        .match(ok, fail),

    deleteEvent: (args: DeleteEventArgs): Promise<ToolResult> =>
      calendar
        .deleteEvent(toDeleteEventInput(args))
        .map(() => ({ deleted: true, calendarId: args.calendarId ?? PRIMARY_CALENDAR, eventId: args.eventId }))
        .match(ok, fail),

    moveEvent: (args: MoveEventArgs): Promise<ToolResult> => calendar.moveEvent(toMoveEventInput(args)).map(toEventView).match(ok, fail),

    quickAddEvent: (args: QuickAddEventArgs): Promise<ToolResult> =>
      toQuickAddEventInput(args)
        .asyncAndThen((input) => calendar.quickAddEvent(input))
        .map(toEventView)
        .match(ok, fail),

    importEvent: (args: ImportEventArgs): Promise<ToolResult> =>
      toImportEventInput(args)
        .asyncAndThen((input) => calendar.importEvent(input))
        .map(toEventView)
        .match(ok, fail),

    queryFreeBusy: (args: FreeBusyArgs): Promise<ToolResult> =>
      toFreeBusyInput(args)
        .asyncAndThen((input) => calendar.queryFreeBusy(input))
        .match(ok, fail),
  };
};

const TIME_HELP =
  "time is { kind: 'allDay', date: 'YYYY-MM-DD', endDate?: inclusive last day } or { kind: 'timed', start, end: RFC 3339 with offset e.g. 2026-11-17T10:00:00+09:00, timeZone?: IANA }.";

export const registerEventTools = (server: McpServer, deps: ToolDeps): void => {
  const handlers = createEventToolHandlers(deps);

  server.registerTool(
    'list_calendars',
    {
      title: 'List calendars',
      description: "List the user's calendars with their ids. Pass an id as calendarId to the other calendar tools ('primary' is the user's own calendar).",
      annotations: READ_ONLY,
    },
    handlers.listCalendars,
  );

  server.registerTool(
    'list_events',
    {
      title: 'List events',
      description:
        'List events of one calendar in a time window, ordered by start (recurring events expanded). Default window: now → 7 days later (Asia/Tokyo). from/to accept YYYY-MM-DD (whole days, to inclusive) or RFC 3339 with offset. Returns event ids for get_event / update_event / delete_event and nextPageToken for more.',
      inputSchema: listEventsArgs,
      annotations: READ_ONLY,
    },
    handlers.listEvents,
  );

  server.registerTool(
    'list_event_instances',
    {
      title: 'List occurrences of a recurring event',
      description:
        'List the occurrences of one recurring event (the series id, e.g. recurrence.recurringEventId of an occurrence) in a window. Default window: now → 90 days later. from/to accept YYYY-MM-DD or RFC 3339 with offset. Each occurrence has its own id for update_event / delete_event (changes that occurrence only).',
      inputSchema: listEventInstancesArgs,
      annotations: READ_ONLY,
    },
    handlers.listEventInstances,
  );

  server.registerTool(
    'get_event',
    {
      title: 'Get event',
      description:
        "Get one event by id (from list_events), including reminders, color, Meet link, iCalUID and status-event properties. A deleted event (or a cancelled occurrence of a series) is still returned, as { status: 'cancelled', deleted: true, note } with no details.",
      inputSchema: eventRefArgs,
      annotations: READ_ONLY,
    },
    handlers.getEvent,
  );

  server.registerTool(
    'create_event',
    {
      title: 'Create event',
      description: `Create an event. ${TIME_HELP} Write the offset explicitly (Asia/Tokyo is +09:00). Optional: optional guests, recurrence (RRULE lines; a timed series needs time.timeZone), reminders, colorId, visibility, transparency, guest permissions, addGoogleMeet, and eventType for focusTime / outOfOffice / workingLocation (primary calendar only). ${GUESTS_MODIFY_NOTE} ${NOTIFY_NOTE} Returns the created event with its id.`,
      inputSchema: createEventArgs,
      annotations: ADDITIVE,
    },
    handlers.createEvent,
  );

  server.registerTool(
    'quick_add_event',
    {
      title: 'Quick add event',
      description: `Create an event from one sentence that Google parses, e.g. "Dinner with Ann at Cafe Friday 7pm". Check the returned time — Google guesses it. Use create_event for exact control. ${NOTIFY_NOTE}`,
      inputSchema: quickAddEventArgs,
      annotations: ADDITIVE,
    },
    handlers.quickAddEvent,
  );

  server.registerTool(
    'import_event',
    {
      title: 'Import event',
      description: `Add a private copy of an existing event (e.g. from an .ics file) identified by its iCalendar UID (events.import). ${TIME_HELP} Takes no sendUpdates (Google's import has no notification setting).`,
      inputSchema: importEventArgs,
      annotations: ADDITIVE,
    },
    handlers.importEvent,
  );

  server.registerTool(
    'update_event',
    {
      title: 'Update event',
      description: `Change an event. Omitted fields are kept. To remove a description / location / all guests / color pass clearDescription / clearLocation / clearAttendees / clearColor: true (never an empty string). attendees + optionalAttendees replace the whole guest list. recurrence replaces every rule. ${TIME_HELP} ${GUESTS_MODIFY_NOTE} ${NOTIFY_NOTE}`,
      inputSchema: updateEventArgs,
      annotations: IDEMPOTENT_UPDATE,
    },
    handlers.updateEvent,
  );

  server.registerTool(
    'move_event',
    {
      title: 'Move event to another calendar',
      description: `Move an event (a normal event, not a focus time / out-of-office / working location one) from calendarId to the destination calendar (changes its organizer calendar). Returns the event as it now is on the destination calendar. ${NOTIFY_NOTE}`,
      inputSchema: moveEventArgs,
      annotations: ADDITIVE,
    },
    handlers.moveEvent,
  );

  server.registerTool(
    'delete_event',
    {
      title: 'Delete event',
      description: `Delete an event by id. For a recurring event occurrence only that occurrence is deleted; the series id deletes every occurrence. Cannot be undone — confirm the id with get_event first. ${NOTIFY_NOTE}`,
      inputSchema: deleteEventArgs,
      annotations: DESTRUCTIVE,
    },
    handlers.deleteEvent,
  );

  server.registerTool(
    'query_freebusy',
    {
      title: 'Query free/busy',
      description: "Busy intervals of up to 50 calendars between from and to (YYYY-MM-DD whole days in Asia/Tokyo, to inclusive, or RFC 3339 with offset). Default calendarIds: ['primary'].",
      inputSchema: freeBusyArgs,
      annotations: READ_ONLY,
    },
    handlers.queryFreeBusy,
  );
};
