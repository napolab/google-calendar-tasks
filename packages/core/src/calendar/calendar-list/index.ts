import { Result, err, ok, okAsync } from 'neverthrow';
import { z } from 'zod';

import { InvalidInputError } from '../../errors';
import { validateReminderOverrides } from '../events/validation';
import { PRIMARY_CALENDAR, calendarIdOf, calendarListEntryURL, calendarListURL, pageQuery } from '../request';
import { emptySchema, reminderOverrideSchema, toNextPage, toTimeZoneRef } from '../schemas';
import { validateHasChange, validateNonEmpty, validateSet, validateTextPatch } from '../validation';

import type { GoogleError } from '../../errors';
import type { GoogleClient } from '../../google-client';
import type {
  CalendarColor,
  CalendarListEntry,
  CalendarRef,
  CalendarSummary,
  FieldPatch,
  ListEntryColor,
  NextPage,
  PageRequest,
  SetPatch,
  SubscribeCalendarInput,
  UnsubscribeCalendarInput,
  UpdateCalendarListEntryInput,
} from '../index';
import type { ResultAsync } from 'neverthrow';

// calendarList: the user's subscriptions to calendars and how each is displayed.

const toCalendarColor = (hex: string | null | undefined): CalendarColor => (hex === null || hex === undefined ? { kind: 'none' } : { kind: 'hex', hex });

const accessRoleSchema = z.enum(['freeBusyReader', 'reader', 'writerWithoutPrivateAccess', 'writer', 'owner']);

const calendarSummarySchema = z
  .object({
    id: z.string(),
    summary: z.string().nullish(),
    summaryOverride: z.string().nullish(),
    primary: z.boolean().nullish(),
    accessRole: accessRoleSchema,
    timeZone: z.string().nullish(),
    backgroundColor: z.string().nullish(),
  })
  .transform((entry): CalendarSummary => ({
    id: entry.id,
    summary: entry.summaryOverride ?? entry.summary ?? '',
    primary: entry.primary === true,
    accessRole: entry.accessRole,
    timeZone: toTimeZoneRef(entry.timeZone),
    backgroundColor: toCalendarColor(entry.backgroundColor),
  }));

type CalendarListPage = { readonly items: readonly CalendarSummary[]; readonly nextPage: NextPage };

const calendarListPageSchema: z.ZodType<CalendarListPage> = z
  .object({ items: z.array(calendarSummarySchema).nullish(), nextPageToken: z.string().nullish() })
  .transform((page) => ({ items: page.items ?? [], nextPage: toNextPage(page.nextPageToken) }));

// Walks every page of the calendar list, accumulating entries until there is no next page.
const listCalendarsFrom = (client: GoogleClient, page: PageRequest, collected: readonly CalendarSummary[]): ResultAsync<readonly CalendarSummary[], GoogleError> =>
  client.request({ method: 'GET', url: calendarListURL, query: { maxResults: 250, pageToken: pageQuery(page) }, schema: calendarListPageSchema }).andThen((result) => {
    const calendars = [...collected, ...result.items];
    switch (result.nextPage.kind) {
      case 'none':
        return okAsync(calendars);
      case 'next':
        return listCalendarsFrom(client, result.nextPage, calendars);
      default: {
        const _exhaustive: never = result.nextPage;
        throw new Error(`unhandled page: ${JSON.stringify(_exhaustive)}`);
      }
    }
  });

export const listCalendars = (client: GoogleClient): ResultAsync<readonly CalendarSummary[], GoogleError> => listCalendarsFrom(client, { kind: 'first' }, []);

// ---- single entries ----

const notificationTypeSchema = z.enum(['eventCreation', 'eventChange', 'eventCancellation', 'eventResponse', 'agenda']);

const calendarListEntrySchema: z.ZodType<CalendarListEntry> = z
  .object({
    id: z.string(),
    summary: z.string().nullish(),
    summaryOverride: z.string().nullish(),
    description: z.string().nullish(),
    location: z.string().nullish(),
    timeZone: z.string().nullish(),
    accessRole: accessRoleSchema,
    primary: z.boolean().nullish(),
    hidden: z.boolean().nullish(),
    selected: z.boolean().nullish(),
    colorId: z.string().nullish(),
    backgroundColor: z.string().nullish(),
    foregroundColor: z.string().nullish(),
    defaultReminders: z.array(reminderOverrideSchema).nullish(),
    notificationSettings: z.object({ notifications: z.array(z.object({ type: notificationTypeSchema })).nullish() }).nullish(),
  })
  .transform((entry) => ({
    id: entry.id,
    summary: entry.summary ?? '',
    summaryOverride: entry.summaryOverride ?? '',
    description: entry.description ?? '',
    location: entry.location ?? '',
    timeZone: toTimeZoneRef(entry.timeZone),
    accessRole: entry.accessRole,
    primary: entry.primary === true,
    // Google returns `hidden` only when true and `selected` defaults to false.
    hidden: entry.hidden === true,
    selected: entry.selected === true,
    colorId: entry.colorId ?? '',
    backgroundColor: toCalendarColor(entry.backgroundColor),
    foregroundColor: toCalendarColor(entry.foregroundColor),
    defaultReminders: entry.defaultReminders ?? [],
    notifications: (entry.notificationSettings?.notifications ?? []).map((notification) => notification.type),
  }));

// ---- validation ----

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const validateHex = (field: string, value: string): Result<string, InvalidInputError> => {
  if (HEX_COLOR.test(value)) return ok(value);
  return err(new InvalidInputError(`${field} "${value}" is not a hex color: expected #RRGGBB, e.g. "#0088aa".`));
};

const validateColor = (color: ListEntryColor): Result<ListEntryColor, InvalidInputError> => {
  switch (color.kind) {
    case 'palette':
      return validateNonEmpty('colorId', color.colorId, 'Pass a calendar color id; get_colors lists them under "calendar".').map(() => color);
    case 'rgb':
      return validateHex('background', color.background)
        .andThen(() => validateHex('foreground', color.foreground))
        .map(() => color);
    default: {
      const _exhaustive: never = color;
      throw new Error(`unhandled color: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateSubscribeColor = (color: SubscribeCalendarInput['color']): Result<void, InvalidInputError> => (color.kind === 'default' ? ok(undefined) : validateColor(color).map(() => undefined));

const validateSubscribe = (input: SubscribeCalendarInput): Result<SubscribeCalendarInput, InvalidInputError> =>
  validateNonEmpty('calendarId', input.calendarId, 'Pass the id of the calendar to add (e.g. "ja.japanese#holiday@group.v.calendar.google.com" or a shared calendar id).')
    .andThen(() => validateSubscribeColor(input.color))
    .map(() => input);

const UPDATABLE = ['summaryOverride', 'color', 'hidden', 'selected', 'defaultReminders', 'notifications'];

const validateUpdate = (input: UpdateCalendarListEntryInput): Result<UpdateCalendarListEntryInput, InvalidInputError> =>
  validateHasChange('updateCalendarListEntry', [input.summaryOverride, input.color, input.hidden, input.selected, input.defaultReminders, input.notifications], UPDATABLE)
    .andThen(() => validateTextPatch('summaryOverride', input.summaryOverride))
    .andThen(() => validateSet(input.color, validateColor))
    .andThen(() => validateSet(input.defaultReminders, validateReminderOverrides))
    .map(() => input);

const validateUnsubscribe = (input: UnsubscribeCalendarInput): Result<UnsubscribeCalendarInput, InvalidInputError> => {
  if (input.calendarId !== PRIMARY_CALENDAR) return validateNonEmpty('calendarId', input.calendarId, 'Pass the id of the calendar to remove (from list_calendars).').map(() => input);
  return err(new InvalidInputError("calendarId 'primary' cannot be removed from the calendar list: it is the user's own calendar. Pass the id of a subscribed calendar (from list_calendars)."));
};

// ---- bodies ----

type ColorBody = { readonly colorId: string | undefined; readonly backgroundColor: string | undefined; readonly foregroundColor: string | undefined };

const toColorBody = (color: SubscribeCalendarInput['color']): ColorBody => {
  switch (color.kind) {
    case 'default':
      return { colorId: undefined, backgroundColor: undefined, foregroundColor: undefined };
    case 'palette':
      return { colorId: color.colorId, backgroundColor: undefined, foregroundColor: undefined };
    case 'rgb':
      return { colorId: undefined, backgroundColor: color.background, foregroundColor: color.foreground };
    default: {
      const _exhaustive: never = color;
      throw new Error(`unhandled color: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// backgroundColor / foregroundColor are only honored with colorRgbFormat=true.
const rgbQuery = (color: SubscribeCalendarInput['color']): { readonly colorRgbFormat: true | undefined } => ({ colorRgbFormat: color.kind === 'rgb' ? true : undefined });

const setValue = <T>(patch: SetPatch<T>): T | undefined => (patch.kind === 'set' ? patch.value : undefined);

// keep → not sent; clear → null (removes the user's override).
const patchOverride = (patch: FieldPatch<string>): string | null | undefined => {
  switch (patch.kind) {
    case 'keep':
      return undefined;
    case 'set':
      return patch.value;
    case 'clear':
      return null;
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const patchColor = (patch: SetPatch<ListEntryColor>): SubscribeCalendarInput['color'] => (patch.kind === 'set' ? patch.value : { kind: 'default' });

const toPatchBody = (input: UpdateCalendarListEntryInput) => {
  const notifications = setValue(input.notifications);
  return {
    summaryOverride: patchOverride(input.summaryOverride),
    hidden: setValue(input.hidden),
    selected: setValue(input.selected),
    ...toColorBody(patchColor(input.color)),
    defaultReminders: setValue(input.defaultReminders),
    notificationSettings: notifications === undefined ? undefined : { notifications: notifications.map((type) => ({ method: 'email', type })) },
  };
};

// ---- operations ----

export const getCalendarListEntry = (client: GoogleClient, input: CalendarRef): ResultAsync<CalendarListEntry, GoogleError> =>
  client.request({ method: 'GET', url: calendarListEntryURL(calendarIdOf(input)), schema: calendarListEntrySchema });

export const subscribeCalendar = (client: GoogleClient, input: SubscribeCalendarInput): ResultAsync<CalendarListEntry, GoogleError | InvalidInputError> =>
  validateSubscribe(input).asyncAndThen(() =>
    client.request({ method: 'POST', url: calendarListURL, query: rgbQuery(input.color), body: { id: input.calendarId, ...toColorBody(input.color) }, schema: calendarListEntrySchema }),
  );

export const updateCalendarListEntry = (client: GoogleClient, input: UpdateCalendarListEntryInput): ResultAsync<CalendarListEntry, GoogleError | InvalidInputError> =>
  validateUpdate(input).asyncAndThen(() =>
    client.request({ method: 'PATCH', url: calendarListEntryURL(calendarIdOf(input)), query: rgbQuery(patchColor(input.color)), body: toPatchBody(input), schema: calendarListEntrySchema }),
  );

export const unsubscribeCalendar = (client: GoogleClient, input: UnsubscribeCalendarInput): ResultAsync<void, GoogleError | InvalidInputError> =>
  validateUnsubscribe(input)
    .asyncAndThen(() => client.request({ method: 'DELETE', url: calendarListEntryURL(input.calendarId), schema: emptySchema }))
    .map(() => undefined);
