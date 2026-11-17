import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { prefixed, renderWith, report, reportMissingSubcommand } from '../shared/output';
import { formatEventDetail, formatEventLine, formatEventPage } from './format';
import { createEventArgs, eventRefArgs, listEventsArgs, toCreateEventInput, toEventRef, toListEventsInput, toUpdateEventInput, updateEventArgs } from './input';

import type { CliContext } from '../../context';
import type { EventRef } from '@napolab/gct-core/calendar';
import type { ArgValues } from 'gunshi';

// `gct events list|get|create|update|delete`. Handlers only wire: flags → core input (pure, ./input) →
// context.services() → service call → render (./format). Input is validated before any Google call.

export type DeletedEvent = { readonly kind: 'deleted'; readonly calendarId: string; readonly eventId: string };

const toDeleted = (ref: EventRef): DeletedEvent => ({ kind: 'deleted', calendarId: ref.calendarId ?? 'primary', eventId: ref.eventId });

const formatDeleted = (deleted: DeletedEvent): string => `Deleted event ${deleted.eventId} from calendar ${deleted.calendarId}.`;

export const runListEvents = (ctx: CliContext, values: ArgValues<typeof listEventsArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toListEventsInput(values, ctx.clock()))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.calendar.listEvents(input))),
    renderWith(values.json, formatEventPage),
  );

export const runGetEvent = (ctx: CliContext, values: ArgValues<typeof eventRefArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.calendar.getEvent(toEventRef(values.eventId, values)))),
    renderWith(values.json, formatEventDetail),
  );

export const runCreateEvent = (ctx: CliContext, values: ArgValues<typeof createEventArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toCreateEventInput(values))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.calendar.createEvent(input))),
    renderWith(values.json, prefixed('Created: ', formatEventLine)),
  );

export const runUpdateEvent = (ctx: CliContext, values: ArgValues<typeof updateEventArgs>, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toUpdateEventInput(values.eventId, values))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.calendar.updateEvent(input))),
    renderWith(values.json, prefixed('Updated: ', formatEventLine)),
  );

export const runDeleteEvent = (ctx: CliContext, values: ArgValues<typeof eventRefArgs>, extra: readonly string[]): Promise<void> => {
  const ref = toEventRef(values.eventId, values);
  return report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.calendar.deleteEvent(ref).map(() => toDeleted(ref)))),
    renderWith(values.json, formatDeleted),
  );
};

const SUBCOMMANDS = ['list', 'get', 'create', 'update', 'delete'];

export const createEventsCommand = (context: CliContext) =>
  define({
    name: 'events',
    description: 'List, show, create, update and delete calendar events',
    subCommands: {
      list: define({
        name: 'list',
        description: 'List events (default: the next 7 days from now, Asia/Tokyo)',
        args: listEventsArgs,
        toKebab: true,
        run: (ctx) => runListEvents(context, ctx.values, extraArgsOf(ctx, 0)),
      }),
      get: define({
        name: 'get',
        description: 'Show one event',
        args: eventRefArgs,
        toKebab: true,
        run: (ctx) => runGetEvent(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
      create: define({
        name: 'create',
        description: 'Create an event: --date for all-day, or --start/--end (RFC 3339 with offset) for timed',
        args: createEventArgs,
        toKebab: true,
        run: (ctx) => runCreateEvent(context, ctx.values, extraArgsOf(ctx, 0)),
      }),
      update: define({
        name: 'update',
        description: 'Change an event: --<field> sets, --clear-<field> removes, absent flags keep the current value',
        args: updateEventArgs,
        toKebab: true,
        run: (ctx) => runUpdateEvent(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
      delete: define({
        name: 'delete',
        description: 'Delete an event',
        args: eventRefArgs,
        toKebab: true,
        run: (ctx) => runDeleteEvent(context, ctx.values, extraArgsOf(ctx, 1)),
      }),
    },
    run: () => reportMissingSubcommand(context.output, 'gct events', SUBCOMMANDS),
  });
