import { z } from 'zod';

import { BASE_URL } from '../request';
import { validateFreeBusy } from '../validation';

import type { GoogleError, InvalidInputError } from '../../errors';
import type { GoogleClient } from '../../google-client';
import type { BusyInterval, CalendarAvailability, FreeBusyInput, FreeBusyResult } from '../index';
import type { ResultAsync } from 'neverthrow';

// freebusy.query.

const busyIntervalSchema: z.ZodType<BusyInterval> = z.object({ start: z.string(), end: z.string() });

const calendarFreeBusySchema = z.object({
  busy: z.array(busyIntervalSchema).nullish(),
  // Per-calendar failures (e.g. `notFound`) arrive inside a 200 response.
  errors: z.array(z.object({ reason: z.string() })).nullish(),
});

const toAvailability = (calendarId: string, wire: z.output<typeof calendarFreeBusySchema>): CalendarAvailability => {
  const reasons = (wire.errors ?? []).map((error) => error.reason);
  if (reasons.length > 0) return { kind: 'error', calendarId, reasons };
  return { kind: 'ok', calendarId, busy: wire.busy ?? [] };
};

const freeBusySchema: z.ZodType<FreeBusyResult> = z.object({ timeMin: z.string(), timeMax: z.string(), calendars: z.record(z.string(), calendarFreeBusySchema) }).transform((result) => ({
  timeMin: result.timeMin,
  timeMax: result.timeMax,
  calendars: Object.entries(result.calendars).map(([calendarId, wire]) => toAvailability(calendarId, wire)),
}));

export const queryFreeBusy = (client: GoogleClient, input: FreeBusyInput): ResultAsync<FreeBusyResult, GoogleError | InvalidInputError> =>
  validateFreeBusy(input).asyncAndThen(() =>
    client.request({
      method: 'POST',
      url: `${BASE_URL}/freeBusy`,
      body: { timeMin: input.timeMin, timeMax: input.timeMax, items: input.calendarIds.map((id) => ({ id })) },
      schema: freeBusySchema,
    }),
  );
