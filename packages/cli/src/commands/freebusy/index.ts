import { define } from 'gunshi';

import { formatInstant, formatInstantRange } from '../shared/display-time';
import { CLI_TIME_ZONE, parseWindowBound, toWindowEnd, toWindowStart } from '../shared/flags/date';
import { extraArgsOf, rejectExtraArgs } from '../shared/flags/extra-args';
import { renderWith, report } from '../shared/output';

import type { CliContext } from '../../context';
import type { InvalidInputError } from '@napolab/gct-core/errors';
import type { CalendarAvailability, FreeBusyInput, FreeBusyResult } from '@napolab/gct-core/calendar';
import type { ArgValues } from 'gunshi';
import type { Result } from 'neverthrow';

// `gct freebusy --from --to [--calendar ...]`: busy intervals of one or more calendars.

const PRIMARY_CALENDAR = 'primary';

export type FreeBusyFlags = Omit<FreeBusyValues, 'json'>;

export const toFreeBusyInput = (flags: FreeBusyFlags): Result<FreeBusyInput, InvalidInputError> =>
  parseWindowBound('--from', flags.from).andThen((from) =>
    parseWindowBound('--to', flags.to).map((to) => ({ timeMin: toWindowStart(from), timeMax: toWindowEnd(to), calendarIds: flags.calendar ?? [PRIMARY_CALENDAR] })),
  );

const formatAvailability = (availability: CalendarAvailability): readonly string[] => {
  switch (availability.kind) {
    case 'ok':
      return availability.busy.length === 0
        ? [`${availability.calendarId}: free`]
        : [`${availability.calendarId}: busy`, ...availability.busy.map((interval) => `  ${formatInstantRange(interval.start, interval.end)}`)];
    case 'error':
      return [`${availability.calendarId}: unavailable (${availability.reasons.join(', ')})`];
    default: {
      const _exhaustive: never = availability;
      throw new Error(`unhandled availability: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const formatFreeBusy = (result: FreeBusyResult): string =>
  [`Free/busy ${formatInstant(result.timeMin)} – ${formatInstant(result.timeMax)} (${CLI_TIME_ZONE})`, ...result.calendars.flatMap(formatAvailability)].join('\n');

export const runFreeBusy = (ctx: CliContext, values: FreeBusyValues, extra: readonly string[]): Promise<void> =>
  report(
    ctx.output,
    rejectExtraArgs(extra)
      .andThen(() => toFreeBusyInput(values))
      .asyncAndThen((input) => ctx.services().andThen((services) => services.calendar.queryFreeBusy(input))),
    renderWith(values.json, formatFreeBusy),
  );

export const createFreeBusyCommand = (context: CliContext) =>
  define({
    name: 'freebusy',
    description: 'Show busy intervals of one or more calendars between --from and --to',
    args: {
      from: { type: 'string', required: true, description: 'Window start: YYYY-MM-DD (Asia/Tokyo) or RFC 3339 with offset' },
      to: { type: 'string', required: true, description: 'Window end: YYYY-MM-DD (inclusive day, Asia/Tokyo) or RFC 3339 with offset' },
      calendar: { type: 'string', multiple: true, description: 'Calendar id to check (repeat for several; default: primary)' },
      json: { type: 'boolean', description: 'Print the result as JSON' },
    },
    run: (ctx): Promise<void> => runFreeBusy(context, ctx.values, extraArgsOf(ctx, 0)),
  });

// Flag values the command parses, derived from its own `args`.
export type FreeBusyValues = ArgValues<ReturnType<typeof createFreeBusyCommand>['args']>;
