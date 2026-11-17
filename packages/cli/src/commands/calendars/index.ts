import { define } from 'gunshi';

import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { renderWith, report } from '../shared/output';

import type { CliContext } from '../../context';
import type { CalendarSummary, TimeZoneRef } from '@napolab/gct-core/calendar';
import type { ArgValues } from 'gunshi';

// `gct calendars`: every calendar in the user's calendar list, with the id other commands take as --calendar.

const zoneSuffix = (zone: TimeZoneRef): string => {
  switch (zone.kind) {
    case 'none':
      return '';
    case 'iana':
      return `, ${zone.name}`;
    default: {
      const _exhaustive: never = zone;
      throw new Error(`unhandled time zone: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const formatCalendar = (calendar: CalendarSummary): string => {
  const marker = calendar.primary ? '*' : ' ';
  const title = calendar.summary === '' ? '(no title)' : calendar.summary;
  return `${marker} ${title}  [${calendar.id}]  (${calendar.accessRole}${zoneSuffix(calendar.timeZone)})`;
};

export const formatCalendars = (calendars: readonly CalendarSummary[]): string => (calendars.length === 0 ? 'No calendars.' : calendars.map(formatCalendar).join('\n'));

export const runCalendars = (ctx: CliContext, values: CalendarsValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra).asyncAndThen(() => ctx.services().andThen((services) => services.calendar.listCalendars())),
    renderWith(values.json, formatCalendars),
  );

export const createCalendarsCommand = (context: CliContext) =>
  define({
    name: 'calendars',
    description: 'List your calendars (* marks the primary one); the bracketed id is what --calendar takes',
    args: {
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    run: (ctx): Promise<void> => runCalendars(context, ctx.values, extraArgsOf(ctx, 0)),
  });

// Flag values the command parses, derived from its own `args`.
export type CalendarsValues = ArgValues<ReturnType<typeof createCalendarsCommand>['args']>;
