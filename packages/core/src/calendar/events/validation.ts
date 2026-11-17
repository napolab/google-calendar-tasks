import { Result, err, ok } from 'neverthrow';

import { dayjs } from '../../dayjs';
import { InvalidInputError } from '../../errors';
import { calendarIdOf } from '../request';
import { validateEventRange, validateNonEmpty, validateSet } from '../validation';

import type {
  ConferencePatch,
  ConferenceRequest,
  CreateEventInput,
  CreateEventType,
  EventColor,
  EventDetails,
  EventTime,
  FieldPatch,
  ImportEventInput,
  MoveEventInput,
  QuickAddEventInput,
  Reminders,
  SetPatch,
  TimePatch,
  UpdateEventInput,
} from '../index';

// Write-side validators for events (.claude/rules/mcp-write-strict.md): reject instead of coercing, and say what
// was wrong, the expected format, and how to fix it — all before any request is sent.

const MAX_REMINDERS = 5;

const MAX_REMINDER_MINUTES = 40320;

// The event palette of colors.get (stable since the API launched).
const EVENT_COLOR_IDS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

// RFC 5545 lines Google accepts in `recurrence`: `RRULE:` / `EXRULE:`, and `RDATE` / `EXDATE` with either `:` or
// parameters (`;VALUE=DATE:`, `;TZID=...:`).
const RECURRENCE_LINE = /^(?:(?:RRULE|EXRULE):|(?:RDATE|EXDATE)[:;])/;

const RECURRENCE_HELP = 'Each line must start with "RRULE:", "EXRULE:", "RDATE" or "EXDATE", e.g. "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10" or "EXDATE;TZID=Asia/Tokyo:20261124T100000"';

// ---- single fields ----

const validateRecurrenceLine = (line: string, index: number): Result<string, InvalidInputError> => {
  if (RECURRENCE_LINE.test(line)) return ok(line);
  if (line.startsWith('DTSTART') || line.startsWith('DTEND'))
    return err(new InvalidInputError(`recurrence[${index}] "${line}" is a DTSTART / DTEND line, which Google rejects. Remove it: the series starts at the event's start (and end).`));
  return err(new InvalidInputError(`recurrence[${index}] "${line}" is not a recurrence line. ${RECURRENCE_HELP}.`));
};

const validateRecurrence = (rules: readonly string[]): Result<readonly string[], InvalidInputError> => Result.combine(rules.map((line, index) => validateRecurrenceLine(line, index))).map(() => rules);

// Google expands a timed series in its start zone, so a timed recurring event must name one.
const validateRecurringZone = (start: EventTime, rules: readonly string[]): Result<void, InvalidInputError> => {
  if (rules.length === 0 || start.kind === 'date' || start.timeZone.kind === 'iana') return ok(undefined);
  return err(
    new InvalidInputError(
      'A timed recurring event needs a time zone to expand the recurrence in, but start.timeZone is { kind: \'none\' }. Pass an IANA zone such as "Asia/Tokyo" as the time zone, or make it all-day.',
    ),
  );
};

const validateReminderMinutes = (minutes: number, index: number): Result<number, InvalidInputError> => {
  if (minutes % 1 === 0 && minutes >= 0 && minutes <= MAX_REMINDER_MINUTES) return ok(minutes);
  return err(new InvalidInputError(`reminders[${index}].minutes ${minutes} is invalid: expected an integer from 0 to ${MAX_REMINDER_MINUTES} (4 weeks) minutes before the start.`));
};

export const validateReminderOverrides = <T extends { readonly minutes: number }>(overrides: readonly T[]): Result<readonly T[], InvalidInputError> => {
  if (overrides.length > MAX_REMINDERS)
    return err(new InvalidInputError(`${overrides.length} reminders were given, but Google allows at most ${MAX_REMINDERS} per event. Keep the ${MAX_REMINDERS} you need most.`));
  return Result.combine(overrides.map((override, index) => validateReminderMinutes(override.minutes, index))).map(() => overrides);
};

const validateReminders = (reminders: Reminders): Result<Reminders, InvalidInputError> => {
  switch (reminders.kind) {
    case 'default':
      return ok(reminders);
    case 'custom':
      return validateReminderOverrides(reminders.overrides).map(() => reminders);
    default: {
      const _exhaustive: never = reminders;
      throw new Error(`unhandled reminders: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateColorId = (colorId: string): Result<string, InvalidInputError> => {
  if (EVENT_COLOR_IDS.includes(colorId)) return ok(colorId);
  return err(new InvalidInputError(`colorId "${colorId}" is not an event color id: expected one of "1" to "11". Call get_colors to see what each id looks like.`));
};

const validateEventColor = (color: EventColor): Result<EventColor, InvalidInputError> => {
  switch (color.kind) {
    case 'calendar':
      return ok(color);
    case 'color':
      return validateColorId(color.colorId).map(() => color);
    default: {
      const _exhaustive: never = color;
      throw new Error(`unhandled color: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateRequestId = (requestId: string): Result<string, InvalidInputError> =>
  requestId === '' ? err(new InvalidInputError('conference requestId is empty. Generate a fresh unique id (e.g. crypto.randomUUID()) for every conference request.')) : ok(requestId);

const validateConferenceRequest = (conference: ConferenceRequest): Result<ConferenceRequest, InvalidInputError> => {
  switch (conference.kind) {
    case 'none':
      return ok(conference);
    case 'meet':
      return validateRequestId(conference.requestId).map(() => conference);
    default: {
      const _exhaustive: never = conference;
      throw new Error(`unhandled conference: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// ---- status event types (focusTime / outOfOffice / workingLocation) ----

const requireTimed = (kind: string, start: EventTime): Result<void, InvalidInputError> => {
  if (start.kind === 'dateTime') return ok(undefined);
  return err(new InvalidInputError(`A ${kind} event cannot be all-day. Make it timed (start and end as RFC 3339 dateTimes with offset).`));
};

const requireSetting = (kind: string, field: string, actual: string, expected: string): Result<void, InvalidInputError> => {
  if (actual === expected) return ok(undefined);
  return err(new InvalidInputError(`A ${kind} event must have ${field} "${expected}", but ${field} is "${actual}". Pass ${field} "${expected}" (or omit it).`));
};

// Google: "All-day working location events cannot span multiple days, but timed events can."
const requireSingleDay = (start: EventTime, end: EventTime): Result<void, InvalidInputError> => {
  if (start.kind !== 'date' || end.kind !== 'date') return ok(undefined);
  if (dayjs.utc(start.date).add(1, 'day').isSame(dayjs.utc(end.date))) return ok(undefined);
  return err(
    new InvalidInputError(`An all-day workingLocation event must cover exactly one day, but it runs from ${start.date} to ${end.date} (end exclusive). Create one event per day, or make it timed.`),
  );
};

const validateStatusType = (input: CreateEventInput, eventType: CreateEventType): Result<void, InvalidInputError> => {
  switch (eventType.kind) {
    case 'default':
      return ok(undefined);
    case 'focusTime':
    case 'outOfOffice':
      return requireTimed(eventType.kind, input.start).andThen(() => requireSetting(eventType.kind, 'transparency', input.transparency, 'opaque'));
    case 'workingLocation':
      return requireSetting(eventType.kind, 'visibility', input.visibility, 'public')
        .andThen(() => requireSetting(eventType.kind, 'transparency', input.transparency, 'transparent'))
        .andThen(() => requireSingleDay(input.start, input.end));
    default: {
      const _exhaustive: never = eventType;
      throw new Error(`unhandled event type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// ---- whole inputs ----

const validateEventDetails = <D extends EventDetails>(details: D): Result<D, InvalidInputError> =>
  validateEventRange(details)
    .andThen(() => validateRecurrence(details.recurrence))
    .andThen(() => validateRecurringZone(details.start, details.recurrence))
    .andThen(() => validateReminders(details.reminders))
    .andThen(() => validateEventColor(details.color))
    .map(() => details);

export const validateCreateEvent = (input: CreateEventInput): Result<CreateEventInput, InvalidInputError> =>
  validateEventDetails(input)
    .andThen(() => validateConferenceRequest(input.conference))
    .andThen(() => validateStatusType(input, input.eventType))
    .map(() => input);

export const validateImportEvent = (input: ImportEventInput): Result<ImportEventInput, InvalidInputError> =>
  validateNonEmpty('iCalUID', input.iCalUID, 'Pass the iCalendar UID of the event being imported (its UID: line), e.g. "abc123@example.com".').andThen(() => validateEventDetails(input));

export const validateQuickAdd = (input: QuickAddEventInput): Result<QuickAddEventInput, InvalidInputError> =>
  validateNonEmpty('text', input.text, 'Pass a sentence describing the event, e.g. "Lunch with Ann tomorrow 12pm".').map(() => input);

export const validateMove = (input: MoveEventInput): Result<MoveEventInput, InvalidInputError> =>
  validateNonEmpty('destination', input.destination, 'Pass the id of the calendar to move the event to (from list_calendars).').andThen(() => {
    const source = calendarIdOf(input);
    if (source !== input.destination) return ok(input);
    return err(new InvalidInputError(`destination "${input.destination}" is the calendar the event is already on. Pass a different calendar id (from list_calendars).`));
  });

// ---- update patches ----

const ambiguousEmptyError = (field: string): InvalidInputError =>
  new InvalidInputError(
    `${field} is set to an empty value. Use { kind: 'clear' } to remove the ${field}, { kind: 'set', value } with a non-empty value to change it, or { kind: 'keep' } to leave it untouched.`,
  );

// `set` with an empty value would duplicate `clear`; only one spelling is accepted.
const validatePatch = <T extends string | readonly unknown[]>(field: string, patch: FieldPatch<T>): Result<FieldPatch<T>, InvalidInputError> => {
  switch (patch.kind) {
    case 'keep':
    case 'clear':
      return ok(patch);
    case 'set':
      return patch.value.length > 0 ? ok(patch) : err(ambiguousEmptyError(field));
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateTimePatch = (patch: TimePatch): Result<TimePatch, InvalidInputError> => {
  switch (patch.kind) {
    case 'keep':
      return ok(patch);
    case 'set':
      return validateEventRange(patch);
    default: {
      const _exhaustive: never = patch;
      throw new Error(`unhandled time patch: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const validateRecurrencePatch = (patch: SetPatch<readonly string[]>): Result<void, InvalidInputError> =>
  validateSet(patch, (rules) =>
    rules.length === 0
      ? err(
          new InvalidInputError(
            'recurrence is set to an empty list. To end a series, set an RRULE with UNTIL or COUNT (e.g. "RRULE:FREQ=WEEKLY;UNTIL=20261231T000000Z"); to keep it, omit recurrence.',
          ),
        )
      : validateRecurrence(rules),
  );

const validateConferencePatch = (patch: ConferencePatch): Result<ConferencePatch, InvalidInputError> => (patch.kind === 'createMeet' ? validateRequestId(patch.requestId).map(() => patch) : ok(patch));

const UPDATABLE_FIELDS = [
  'summary',
  'description',
  'location',
  'attendees',
  'time',
  'recurrence',
  'reminders',
  'color',
  'visibility',
  'transparency',
  'guestsCanModify',
  'guestsCanInviteOthers',
  'guestsCanSeeOtherGuests',
  'conference',
  'statusProperties',
] as const satisfies readonly (keyof UpdateEventInput)[];

const changesSomething = (input: UpdateEventInput): boolean => UPDATABLE_FIELDS.some((field) => input[field].kind !== 'keep');

const validateHasChange = (input: UpdateEventInput): Result<UpdateEventInput, InvalidInputError> => {
  if (changesSomething(input)) return ok(input);
  return err(
    new InvalidInputError(`updateEvent has no field to change: every field is { kind: 'keep' }. Set at least one of ${UPDATABLE_FIELDS.join(', ')} to { kind: 'set', ... } (or { kind: 'clear' }).`),
  );
};

export const validateEventUpdate = (input: UpdateEventInput): Result<UpdateEventInput, InvalidInputError> =>
  validateHasChange(input)
    .andThen(() => validatePatch('summary', input.summary))
    .andThen(() => validatePatch('description', input.description))
    .andThen(() => validatePatch('location', input.location))
    .andThen(() => validatePatch('attendees', input.attendees))
    .andThen(() => validateTimePatch(input.time))
    .andThen(() => validateRecurrencePatch(input.recurrence))
    .andThen(() => validateSet(input.reminders, validateReminders))
    .andThen(() => validateSet(input.color, validateColorId))
    .andThen(() => validateConferencePatch(input.conference))
    .map(() => input);
