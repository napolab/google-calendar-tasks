import { z } from 'zod';

import { eventTimeSchema, reminderOverrideSchema, toNextPage } from '../schemas';

import type { CalendarEvent, Conference, EventType, NextPage, Recurrence, Reminders, WorkingLocation } from '../index';

// Google Calendar v3 event wire shapes, converted straight into the domain unions. Absent values become the
// state Google documents for them (no reminders object = calendar default, no colorId = calendar color, ...).

const attendeeSchema = z
  .object({ email: z.string(), responseStatus: z.enum(['needsAction', 'declined', 'tentative', 'accepted']).nullish(), optional: z.boolean().nullish() })
  // Google's own default for an attendee who has not answered.
  .transform((attendee) => ({ email: attendee.email, responseStatus: attendee.responseStatus ?? 'needsAction', optional: attendee.optional === true }));

const recurrenceWireSchema = z.object({
  recurrence: z.array(z.string()).nullish(),
  recurringEventId: z.string().nullish(),
  originalStartTime: eventTimeSchema.nullish(),
});

type RecurrenceWire = z.output<typeof recurrenceWireSchema>;

// An instance must say which series it belongs to and which slot it occupies; `undefined` = malformed.
const toRecurrence = (wire: RecurrenceWire): Recurrence | undefined => {
  if (wire.recurringEventId !== null && wire.recurringEventId !== undefined) {
    if (wire.originalStartTime === null || wire.originalStartTime === undefined) return undefined;
    return { kind: 'instance', recurringEventId: wire.recurringEventId, originalStartTime: wire.originalStartTime };
  }
  if (wire.recurrence !== null && wire.recurrence !== undefined && wire.recurrence.length > 0) return { kind: 'series', rules: wire.recurrence };
  return { kind: 'single' };
};

const MALFORMED_INSTANCE = 'a recurring event instance (recurringEventId) must carry originalStartTime';

const remindersSchema = z.object({ useDefault: z.boolean().nullish(), overrides: z.array(reminderOverrideSchema).nullish() });

const toReminders = (wire: z.output<typeof remindersSchema> | null | undefined): Reminders => {
  if (wire === null || wire === undefined || wire.useDefault !== false) return { kind: 'default' };
  return { kind: 'custom', overrides: wire.overrides ?? [] };
};

const autoDeclineSchema = z.enum(['declineNone', 'declineAllConflictingInvitations', 'declineOnlyNewConflictingInvitations']);

const focusTimeSchema = z.object({ autoDeclineMode: autoDeclineSchema.nullish(), declineMessage: z.string().nullish(), chatStatus: z.enum(['available', 'doNotDisturb']).nullish() });

const outOfOfficeSchema = z.object({ autoDeclineMode: autoDeclineSchema.nullish(), declineMessage: z.string().nullish() });

const workingLocationSchema = z.object({
  type: z.enum(['homeOffice', 'officeLocation', 'customLocation']),
  customLocation: z.object({ label: z.string().nullish() }).nullish(),
  officeLocation: z
    .object({ label: z.string().nullish(), buildingId: z.string().nullish(), floorId: z.string().nullish(), floorSectionId: z.string().nullish(), deskId: z.string().nullish() })
    .nullish(),
});

const toWorkingLocation = (wire: z.output<typeof workingLocationSchema>): WorkingLocation => {
  switch (wire.type) {
    case 'homeOffice':
      return { type: 'homeOffice' };
    case 'customLocation':
      return { type: 'customLocation', label: wire.customLocation?.label ?? '' };
    case 'officeLocation': {
      const office = wire.officeLocation;
      return {
        type: 'officeLocation',
        office: { label: office?.label ?? '', buildingId: office?.buildingId ?? '', floorId: office?.floorId ?? '', floorSectionId: office?.floorSectionId ?? '', deskId: office?.deskId ?? '' },
      };
    }
    default: {
      const _exhaustive: never = wire.type;
      throw new Error(`unhandled working location: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const eventTypeWireSchema = z.object({
  eventType: z.enum(['default', 'birthday', 'focusTime', 'fromGmail', 'outOfOffice', 'workingLocation']).nullish(),
  focusTimeProperties: focusTimeSchema.nullish(),
  outOfOfficeProperties: outOfOfficeSchema.nullish(),
  workingLocationProperties: workingLocationSchema.nullish(),
});

// Absent status properties read as "nothing configured": no auto-decline, no message, chat available.
const toEventType = (wire: z.output<typeof eventTypeWireSchema>): EventType => {
  const kind = wire.eventType ?? 'default';
  switch (kind) {
    case 'default':
    case 'birthday':
    case 'fromGmail':
      return { kind };
    case 'focusTime':
      return {
        kind,
        properties: {
          autoDeclineMode: wire.focusTimeProperties?.autoDeclineMode ?? 'declineNone',
          declineMessage: wire.focusTimeProperties?.declineMessage ?? '',
          chatStatus: wire.focusTimeProperties?.chatStatus ?? 'available',
        },
      };
    case 'outOfOffice':
      return { kind, properties: { autoDeclineMode: wire.outOfOfficeProperties?.autoDeclineMode ?? 'declineNone', declineMessage: wire.outOfOfficeProperties?.declineMessage ?? '' } };
    case 'workingLocation': {
      const location = wire.workingLocationProperties;
      return { kind, location: location === null || location === undefined ? { type: 'unknown' } : toWorkingLocation(location) };
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unhandled event type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const entryPointSchema = z
  .object({ entryPointType: z.enum(['video', 'phone', 'sip', 'more']), uri: z.string().nullish(), label: z.string().nullish(), pin: z.string().nullish() })
  .transform((entry) => ({ type: entry.entryPointType, uri: entry.uri ?? '', label: entry.label ?? '', pin: entry.pin ?? '' }));

const conferenceDataSchema = z.object({
  conferenceId: z.string().nullish(),
  conferenceSolution: z.object({ name: z.string().nullish() }).nullish(),
  entryPoints: z.array(entryPointSchema).nullish(),
  createRequest: z.object({ status: z.object({ statusCode: z.enum(['pending', 'success', 'failure']) }).nullish() }).nullish(),
});

// A conference without a createRequest was attached directly, so it is ready.
const toConference = (wire: z.output<typeof conferenceDataSchema> | null | undefined): Conference => {
  if (wire === null || wire === undefined) return { kind: 'none' };
  return {
    kind: 'conference',
    status: wire.createRequest?.status?.statusCode ?? 'success',
    conferenceId: wire.conferenceId ?? '',
    solution: wire.conferenceSolution?.name ?? '',
    entryPoints: wire.entryPoints ?? [],
  };
};

// Distributes over the union: the event resource does not say which calendar it belongs to,
// so the service adds `calendarId` from the request.
type WithoutCalendarId<T> = T extends unknown ? Omit<T, 'calendarId'> : never;

export type GoogleEvent = WithoutCalendarId<CalendarEvent>;

const cancelledEventSchema = recurrenceWireSchema.extend({ id: z.string(), status: z.literal('cancelled') }).transform((event, ctx): GoogleEvent => {
  const recurrence = toRecurrence(event);
  if (recurrence === undefined) {
    ctx.addIssue({ code: 'custom', message: MALFORMED_INSTANCE });
    return z.NEVER;
  }
  return { status: 'cancelled', id: event.id, recurrence };
});

const activeEventSchema = recurrenceWireSchema
  .extend(eventTypeWireSchema.shape)
  .extend({
    id: z.string(),
    // Absent status means the event is confirmed.
    status: z.enum(['confirmed', 'tentative']).nullish(),
    // Empty for untitled events and for private events the caller can only see as busy.
    summary: z.string().nullish(),
    description: z.string().nullish(),
    location: z.string().nullish(),
    start: eventTimeSchema,
    end: eventTimeSchema,
    htmlLink: z.string().nullish(),
    attendees: z.array(attendeeSchema).nullish(),
    reminders: remindersSchema.nullish(),
    colorId: z.string().nullish(),
    visibility: z.enum(['default', 'public', 'private', 'confidential']).nullish(),
    transparency: z.enum(['opaque', 'transparent']).nullish(),
    guestsCanModify: z.boolean().nullish(),
    guestsCanInviteOthers: z.boolean().nullish(),
    guestsCanSeeOtherGuests: z.boolean().nullish(),
    conferenceData: conferenceDataSchema.nullish(),
    hangoutLink: z.string().nullish(),
    iCalUID: z.string().nullish(),
    created: z.string().nullish(),
    updated: z.string().nullish(),
  })
  .transform((event, ctx): GoogleEvent => {
    const recurrence = toRecurrence(event);
    if (recurrence === undefined) {
      ctx.addIssue({ code: 'custom', message: MALFORMED_INSTANCE });
      return z.NEVER;
    }
    return {
      status: event.status ?? 'confirmed',
      id: event.id,
      summary: event.summary ?? '',
      description: event.description ?? '',
      location: event.location ?? '',
      start: event.start,
      end: event.end,
      htmlLink: event.htmlLink ?? '',
      attendees: event.attendees ?? [],
      recurrence,
      eventType: toEventType(event),
      reminders: toReminders(event.reminders),
      color: event.colorId === null || event.colorId === undefined ? { kind: 'calendar' } : { kind: 'color', colorId: event.colorId },
      // Google's documented defaults for absent values.
      visibility: event.visibility ?? 'default',
      transparency: event.transparency ?? 'opaque',
      guests: { canModify: event.guestsCanModify === true, canInviteOthers: event.guestsCanInviteOthers !== false, canSeeOtherGuests: event.guestsCanSeeOtherGuests !== false },
      conference: toConference(event.conferenceData),
      hangoutLink: event.hangoutLink ?? '',
      iCalUID: event.iCalUID ?? '',
      created: event.created ?? '',
      updated: event.updated ?? '',
    };
  });

export const eventSchema: z.ZodType<GoogleEvent> = z.union([cancelledEventSchema, activeEventSchema]);

export type EventListPage = { readonly items: readonly GoogleEvent[]; readonly nextPage: NextPage };

export const eventListPageSchema: z.ZodType<EventListPage> = z
  .object({ items: z.array(eventSchema).nullish(), nextPageToken: z.string().nullish() })
  .transform((page) => ({ items: page.items ?? [], nextPage: toNextPage(page.nextPageToken) }));
