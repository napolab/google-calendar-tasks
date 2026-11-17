import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { prefixed, renderWith, report, reportMissingSubcommand } from '../shared/output';
import { formatEventDetail, formatEventLine, formatEventPage } from './format';
import { DATE_TIME_EXAMPLE, DEFAULT_WINDOW_DAYS, toCreateEventInput, toEventRef, toListEventsInput, toUpdateEventInput } from './input';

import type { CliContext } from '../../context';
import type { EventRef } from '@napolab/gct-core/calendar';
import type { ArgValues } from 'gunshi';

// `gct events list|get|create|update|delete`. Handlers only wire: flags → core input (pure, ./input) →
// context.services() → service call → render (./format). Input is validated before any Google call.

export type DeletedEvent = { readonly kind: 'deleted'; readonly calendarId: string; readonly eventId: string };

const toDeleted = (ref: EventRef): DeletedEvent => ({ kind: 'deleted', calendarId: ref.calendarId ?? 'primary', eventId: ref.eventId });

const formatDeleted = (deleted: DeletedEvent): string => `Deleted event ${deleted.eventId} from calendar ${deleted.calendarId}.`;

export const runListEvents = (ctx: CliContext, values: ListEventsValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toListEventsInput(values, ctx.clock()))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.calendar.listEvents(input))),
    renderWith(values.json, formatEventPage),
  );

export const runGetEvent = (ctx: CliContext, values: GetEventValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.calendar.getEvent(toEventRef(values.eventId, values)))),
    renderWith(values.json, formatEventDetail),
  );

export const runCreateEvent = (ctx: CliContext, values: CreateEventValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toCreateEventInput(values))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.calendar.createEvent(input))),
    renderWith(values.json, prefixed('Created: ', formatEventLine)),
  );

export const runUpdateEvent = (ctx: CliContext, values: UpdateEventValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toUpdateEventInput(values.eventId, values))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.calendar.updateEvent(input))),
    renderWith(values.json, prefixed('Updated: ', formatEventLine)),
  );

export const runDeleteEvent = (ctx: CliContext, values: DeleteEventValues, extra: readonly string[]): Promise<void> => {
  const ref = toEventRef(values.eventId, values);
  return report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.calendar.deleteEvent({ ...ref, sendUpdates: 'none' }).map(() => toDeleted(ref)))),
    renderWith(values.json, formatDeleted),
  );
};

export const createListEventsCommand = (context: CliContext) =>
  define({
    name: 'list',
    description: 'List events (default: the next 7 days from now, Asia/Tokyo)',
    args: {
      calendar: { type: 'string', description: "Calendar id (default: your primary calendar; see 'gct calendars')" },
      from: { type: 'string', description: `Window start: YYYY-MM-DD (Asia/Tokyo) or RFC 3339 with offset (default: now)` },
      to: { type: 'string', description: `Window end: YYYY-MM-DD (inclusive day, Asia/Tokyo) or RFC 3339 with offset (default: ${DEFAULT_WINDOW_DAYS} days after --from)` },
      search: { type: 'string', description: 'Free-text search over summary, description, location and attendees' },
      max: { type: 'number', default: 50, description: 'Events per page (1-2500)' },
      pageToken: { type: 'string', description: 'Page token printed by the previous page' },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runListEvents(context, ctx.values, extraArgsOf(ctx, 0)),
  });

export const createGetEventCommand = (context: CliContext) =>
  define({
    name: 'get',
    description: 'Show one event',
    args: {
      eventId: { type: 'positional', description: 'Event id (shown in brackets by `gct events list`)' },
      calendar: { type: 'string', description: "Calendar id (default: your primary calendar; see 'gct calendars')" },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runGetEvent(context, ctx.values, extraArgsOf(ctx, 1)),
  });

export const createCreateEventCommand = (context: CliContext) =>
  define({
    name: 'create',
    description: 'Create an event: --date for all-day, or --start/--end (RFC 3339 with offset) for timed',
    args: {
      summary: { type: 'string', required: true, description: 'Event title' },
      date: { type: 'string', description: 'All-day event on this date (YYYY-MM-DD)' },
      endDate: { type: 'string', description: 'Last day of a multi-day all-day event, inclusive (YYYY-MM-DD; needs --date)' },
      start: { type: 'string', description: `Start of a timed event, RFC 3339 with offset (e.g. ${DATE_TIME_EXAMPLE})` },
      end: { type: 'string', description: 'End of a timed event, RFC 3339 with offset' },
      timeZone: { type: 'string', description: 'IANA zone a timed event is anchored to (e.g. Asia/Tokyo); the offset alone is used when absent' },
      description: { type: 'string', description: 'Event description' },
      location: { type: 'string', description: 'Event location' },
      attendee: { type: 'string', multiple: true, description: 'Attendee email (repeat for several)' },
      calendar: { type: 'string', description: "Calendar id (default: your primary calendar; see 'gct calendars')" },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runCreateEvent(context, ctx.values, extraArgsOf(ctx, 0)),
  });

export const createUpdateEventCommand = (context: CliContext) =>
  define({
    name: 'update',
    description: 'Change an event: --<field> sets, --clear-<field> removes, absent flags keep the current value',
    args: {
      eventId: { type: 'positional', description: 'Event id (shown in brackets by `gct events list`)' },
      summary: { type: 'string', description: 'New title' },
      description: { type: 'string', description: 'New description' },
      clearDescription: { type: 'boolean', description: 'Remove the description' },
      location: { type: 'string', description: 'New location' },
      clearLocation: { type: 'boolean', description: 'Remove the location' },
      attendee: { type: 'string', multiple: true, description: 'Replace the attendees with these emails (repeat for several)' },
      clearAttendees: { type: 'boolean', description: 'Remove every attendee' },
      date: { type: 'string', description: 'All-day event on this date (YYYY-MM-DD)' },
      endDate: { type: 'string', description: 'Last day of a multi-day all-day event, inclusive (YYYY-MM-DD; needs --date)' },
      start: { type: 'string', description: `Start of a timed event, RFC 3339 with offset (e.g. ${DATE_TIME_EXAMPLE})` },
      end: { type: 'string', description: 'End of a timed event, RFC 3339 with offset' },
      timeZone: { type: 'string', description: 'IANA zone a timed event is anchored to (e.g. Asia/Tokyo); the offset alone is used when absent' },
      calendar: { type: 'string', description: "Calendar id (default: your primary calendar; see 'gct calendars')" },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runUpdateEvent(context, ctx.values, extraArgsOf(ctx, 1)),
  });

export const createDeleteEventCommand = (context: CliContext) =>
  define({
    name: 'delete',
    description: 'Delete an event',
    args: {
      eventId: { type: 'positional', description: 'Event id (shown in brackets by `gct events list`)' },
      calendar: { type: 'string', description: "Calendar id (default: your primary calendar; see 'gct calendars')" },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    toKebab: true,
    run: (ctx): Promise<void> => runDeleteEvent(context, ctx.values, extraArgsOf(ctx, 1)),
  });

// Flag values each command parses, derived from its own `args`.
export type ListEventsValues = ArgValues<ReturnType<typeof createListEventsCommand>['args']>;
export type GetEventValues = ArgValues<ReturnType<typeof createGetEventCommand>['args']>;
export type CreateEventValues = ArgValues<ReturnType<typeof createCreateEventCommand>['args']>;
export type UpdateEventValues = ArgValues<ReturnType<typeof createUpdateEventCommand>['args']>;
export type DeleteEventValues = ArgValues<ReturnType<typeof createDeleteEventCommand>['args']>;

const SUBCOMMANDS = ['list', 'get', 'create', 'update', 'delete'];

export const createEventsCommand = (context: CliContext) =>
  define({
    name: 'events',
    description: 'List, show, create, update and delete calendar events',
    subCommands: {
      list: createListEventsCommand(context),
      get: createGetEventCommand(context),
      create: createCreateEventCommand(context),
      update: createUpdateEventCommand(context),
      delete: createDeleteEventCommand(context),
    },
    run: () => reportMissingSubcommand(context.output, 'gct events', SUBCOMMANDS),
  });
