import { Result, err } from 'neverthrow';
import { z } from 'zod';

import { InvalidInputError } from '../../errors';
import { BASE_URL, PRIMARY_CALENDAR, calendarIdOf, calendarURL } from '../request';
import { emptySchema, toTimeZoneRef } from '../schemas';
import { validateHasChange, validateNonEmpty, validateSet, validateTextPatch, validateTimeZoneName, validateTimeZoneRef } from '../validation';

import type { GoogleError } from '../../errors';
import type { GoogleClient } from '../../google-client';
import type { Calendar, CalendarRef, CreateCalendarInput, DeleteCalendarInput, FieldPatch, SetPatch, TimeZoneRef, UpdateCalendarInput } from '../index';
import type { ResultAsync } from 'neverthrow';

// calendars.*: the calendar itself (title, description, zone). Secondary calendars are created and deleted here;
// the primary calendar can only be cleared.

const calendarSchema: z.ZodType<Calendar> = z
  .object({
    id: z.string(),
    summary: z.string().nullish(),
    description: z.string().nullish(),
    location: z.string().nullish(),
    timeZone: z.string().nullish(),
    dataOwner: z.string().nullish(),
  })
  .transform((calendar) => ({
    id: calendar.id,
    summary: calendar.summary ?? '',
    description: calendar.description ?? '',
    location: calendar.location ?? '',
    timeZone: toTimeZoneRef(calendar.timeZone),
    dataOwner: calendar.dataOwner === null || calendar.dataOwner === undefined ? { kind: 'none' } : { kind: 'email', email: calendar.dataOwner },
  }));

const SUMMARY_HINT = 'Pass the calendar title.';

// ---- bodies ----

// '' = not set, so it is not sent.
const textOrUndefined = (value: string): string | undefined => (value === '' ? undefined : value);

const zoneOrUndefined = (zone: TimeZoneRef): string | undefined => {
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

const toCreateBody = (input: CreateCalendarInput) => ({
  summary: input.summary,
  description: textOrUndefined(input.description),
  location: textOrUndefined(input.location),
  timeZone: zoneOrUndefined(input.timeZone),
});

const setValue = <T>(patch: SetPatch<T>): T | undefined => (patch.kind === 'set' ? patch.value : undefined);

// keep → not sent; clear → '' (Google's empty text).
const patchText = (patch: FieldPatch<string>): string | undefined => {
  switch (patch.kind) {
    case 'keep':
      return undefined;
    case 'set':
      return patch.value;
    case 'clear':
      return '';
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const toPatchBody = (input: UpdateCalendarInput) => ({
  summary: setValue(input.summary),
  description: patchText(input.description),
  location: patchText(input.location),
  timeZone: setValue(input.timeZone),
});

// ---- validation ----

const validateCreate = (input: CreateCalendarInput): Result<CreateCalendarInput, InvalidInputError> =>
  validateNonEmpty('summary', input.summary, SUMMARY_HINT)
    .andThen(() => validateTimeZoneRef('timeZone', input.timeZone))
    .map(() => input);

const validateUpdate = (input: UpdateCalendarInput): Result<UpdateCalendarInput, InvalidInputError> =>
  validateHasChange('updateCalendar', [input.summary, input.description, input.location, input.timeZone], ['summary', 'description', 'location', 'timeZone'])
    .andThen(() => validateSet(input.summary, (summary) => validateNonEmpty('summary', summary, SUMMARY_HINT)))
    .andThen(() => validateTextPatch('description', input.description))
    .andThen(() => validateTextPatch('location', input.location))
    .andThen(() => validateSet(input.timeZone, (zone) => validateTimeZoneName('timeZone', zone)))
    .map(() => input);

const validateDelete = (input: DeleteCalendarInput): Result<DeleteCalendarInput, InvalidInputError> => {
  if (input.calendarId !== PRIMARY_CALENDAR) return validateNonEmpty('calendarId', input.calendarId, 'Pass the id of the secondary calendar to delete (from list_calendars).').map(() => input);
  return err(
    new InvalidInputError(
      "calendarId 'primary' cannot be deleted: Google only deletes secondary calendars. To delete every event of the primary calendar use clear_calendar; to stop showing a calendar someone else owns use unsubscribe_calendar.",
    ),
  );
};

// ---- operations ----

export const getCalendar = (client: GoogleClient, input: CalendarRef): ResultAsync<Calendar, GoogleError> =>
  client.request({ method: 'GET', url: calendarURL(calendarIdOf(input)), schema: calendarSchema });

export const createCalendar = (client: GoogleClient, input: CreateCalendarInput): ResultAsync<Calendar, GoogleError | InvalidInputError> =>
  validateCreate(input).asyncAndThen(() => client.request({ method: 'POST', url: `${BASE_URL}/calendars`, body: toCreateBody(input), schema: calendarSchema }));

export const updateCalendar = (client: GoogleClient, input: UpdateCalendarInput): ResultAsync<Calendar, GoogleError | InvalidInputError> =>
  validateUpdate(input).asyncAndThen(() => client.request({ method: 'PATCH', url: calendarURL(calendarIdOf(input)), body: toPatchBody(input), schema: calendarSchema }));

export const deleteCalendar = (client: GoogleClient, input: DeleteCalendarInput): ResultAsync<void, GoogleError | InvalidInputError> =>
  validateDelete(input)
    .asyncAndThen(() => client.request({ method: 'DELETE', url: calendarURL(input.calendarId), schema: emptySchema }))
    .map(() => undefined);

// calendars.clear only applies to the primary calendar, so it takes no id.
export const clearPrimaryCalendar = (client: GoogleClient): ResultAsync<void, GoogleError> =>
  client.request({ method: 'POST', url: `${calendarURL(PRIMARY_CALENDAR)}/clear`, schema: emptySchema }).map(() => undefined);
