import { ok, toToolError } from '../tool-result';
import { createEventArgs, eventRefArgs, freeBusyArgs, listEventsArgs, toCreateEventInput, toEventRef, toFreeBusyInput, toListEventsInput, toUpdateEventInput, updateEventArgs } from './input';
import { toCalendarView, toEventPageView, toEventView } from './view';

import type { ToolDeps } from '../tool-deps';
import type { ToolResult } from '../tool-result';
import type { CreateEventArgs, EventRefArgs, FreeBusyArgs, ListEventsArgs, UpdateEventArgs } from './input';
import type { McpServer } from '@modelcontextprotocol/server';

// Google Calendar tools. Each handler: arguments → core input (./input, validated before any Google call) →
// service call → normalized view (./view) → ToolResult (the single .match edge).

const PRIMARY_CALENDAR = 'primary';

export const createCalendarToolHandlers = (deps: ToolDeps) => {
  const { calendar } = deps.services;
  const fail = toToolError(deps.connectURL);

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

    getEvent: (args: EventRefArgs): Promise<ToolResult> => calendar.getEvent(toEventRef(args)).map(toEventView).match(ok, fail),

    createEvent: (args: CreateEventArgs): Promise<ToolResult> =>
      toCreateEventInput(args)
        .asyncAndThen((input) => calendar.createEvent(input))
        .map(toEventView)
        .match(ok, fail),

    updateEvent: (args: UpdateEventArgs): Promise<ToolResult> =>
      toUpdateEventInput(args)
        .asyncAndThen((input) => calendar.updateEvent(input))
        .map(toEventView)
        .match(ok, fail),

    deleteEvent: (args: EventRefArgs): Promise<ToolResult> =>
      calendar
        .deleteEvent(toEventRef(args))
        .map(() => ({ deleted: true, calendarId: args.calendarId ?? PRIMARY_CALENDAR, eventId: args.eventId }))
        .match(ok, fail),

    queryFreeBusy: (args: FreeBusyArgs): Promise<ToolResult> =>
      toFreeBusyInput(args)
        .asyncAndThen((input) => calendar.queryFreeBusy(input))
        .match(ok, fail),
  };
};

const TIME_HELP =
  "time is { kind: 'allDay', date: 'YYYY-MM-DD', endDate?: inclusive last day } or { kind: 'timed', start, end: RFC 3339 with offset e.g. 2026-11-17T10:00:00+09:00, timeZone?: IANA }.";

export const registerCalendarTools = (server: McpServer, deps: ToolDeps): void => {
  const handlers = createCalendarToolHandlers(deps);

  server.registerTool(
    'list_calendars',
    {
      title: 'List calendars',
      description: "List the user's calendars with their ids. Pass an id as calendarId to the other calendar tools ('primary' is the user's own calendar).",
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
    },
    handlers.listEvents,
  );

  server.registerTool('get_event', { title: 'Get event', description: 'Get one event by id (from list_events).', inputSchema: eventRefArgs, annotations: { readOnlyHint: true } }, handlers.getEvent);

  server.registerTool(
    'create_event',
    {
      title: 'Create event',
      description: `Create an event. ${TIME_HELP} Write the offset explicitly (Asia/Tokyo is +09:00). Returns the created event with its id.`,
      inputSchema: createEventArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    handlers.createEvent,
  );

  server.registerTool(
    'update_event',
    {
      title: 'Update event',
      description: `Change an event. Omitted fields are kept. To remove a description / location / all attendees pass clearDescription / clearLocation / clearAttendees: true (never an empty string). attendees replaces the whole list. ${TIME_HELP}`,
      inputSchema: updateEventArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handlers.updateEvent,
  );

  server.registerTool(
    'delete_event',
    {
      title: 'Delete event',
      description: 'Delete an event by id. For a recurring event instance only that occurrence is deleted. Cannot be undone — confirm the id with get_event first.',
      inputSchema: eventRefArgs,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    handlers.deleteEvent,
  );

  server.registerTool(
    'query_freebusy',
    {
      title: 'Query free/busy',
      description: "Busy intervals of up to 50 calendars between from and to (YYYY-MM-DD whole days in Asia/Tokyo, to inclusive, or RFC 3339 with offset). Default calendarIds: ['primary'].",
      inputSchema: freeBusyArgs,
      annotations: { readOnlyHint: true },
    },
    handlers.queryFreeBusy,
  );
};
