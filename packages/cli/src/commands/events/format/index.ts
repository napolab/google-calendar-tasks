import { dayjs } from '@napolab/gct-core/dayjs';

import { formatInstant, formatInstantRange } from '../../shared/display-time';

import type { ActiveEvent, Attendee, CalendarEvent, EventPage, EventTime, NextPage, Recurrence } from '@napolab/gct-core/calendar';

// Human-readable event output. Times are shown in Asia/Tokyo; all-day ranges show their inclusive last day.

const previousDate = (date: string): string => dayjs.utc(date).subtract(1, 'day').format('YYYY-MM-DD');

const formatAllDay = (start: string, endExclusive: string): string => {
  const last = previousDate(endExclusive);
  return last <= start ? `${start} (all day)` : `${start} – ${last} (all day)`;
};

const formatPoint = (time: EventTime): string => {
  switch (time.kind) {
    case 'date':
      return time.date;
    case 'dateTime':
      return formatInstant(time.dateTime);
    default: {
      const _exhaustive: never = time;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Mixed kinds never come from Google; they are shown plainly as both ends.
const formatMixed = (start: EventTime, end: EventTime): string => `${formatPoint(start)} – ${formatPoint(end)}`;

export const formatWhen = (start: EventTime, end: EventTime): string => {
  switch (start.kind) {
    case 'date':
      return end.kind === 'date' ? formatAllDay(start.date, end.date) : formatMixed(start, end);
    case 'dateTime':
      return end.kind === 'dateTime' ? formatInstantRange(start.dateTime, end.dateTime) : formatMixed(start, end);
    default: {
      const _exhaustive: never = start;
      throw new Error(`unhandled event time: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const titleOf = (event: ActiveEvent): string => {
  const title = event.summary === '' ? '(no title)' : event.summary;
  const tentative = event.status === 'tentative' ? ' (tentative)' : '';
  const location = event.location === '' ? '' : ` @ ${event.location}`;
  return `${title}${tentative}${location}`;
};

export const formatEventLine = (event: CalendarEvent): string => {
  switch (event.status) {
    case 'confirmed':
    case 'tentative':
      return `${formatWhen(event.start, event.end)}  ${titleOf(event)}  [${event.id}]`;
    case 'cancelled':
      return `(cancelled)  [${event.id}]`;
    default: {
      const _exhaustive: never = event;
      throw new Error(`unhandled event: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const nextPageLines = (nextPage: NextPage): readonly string[] => {
  switch (nextPage.kind) {
    case 'none':
      return [];
    case 'next':
      return [`More events: --page-token ${nextPage.pageToken}`];
    default: {
      const _exhaustive: never = nextPage;
      throw new Error(`unhandled page: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const formatEventPage = (page: EventPage): string => {
  const lines = [...page.events.map(formatEventLine), ...nextPageLines(page.nextPage)];
  return lines.length === 0 ? 'No events.' : lines.join('\n');
};

const recurrenceLines = (recurrence: Recurrence): readonly string[] => {
  switch (recurrence.kind) {
    case 'single':
      return [];
    case 'series':
      return [`Repeats: ${recurrence.rules.join('; ')}`];
    case 'instance':
      return [`Occurrence of: ${recurrence.recurringEventId}`];
    default: {
      const _exhaustive: never = recurrence;
      throw new Error(`unhandled recurrence: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const optionalLine = (label: string, value: string): readonly string[] => (value === '' ? [] : [`${label}: ${value}`]);

const formatAttendee = (attendee: Attendee): string => `${attendee.email} (${attendee.responseStatus})`;

const activeDetail = (event: ActiveEvent): string =>
  [
    titleOf(event),
    `When: ${formatWhen(event.start, event.end)}`,
    ...optionalLine('Location', event.location),
    ...optionalLine('Description', event.description),
    ...optionalLine('Attendees', event.attendees.map(formatAttendee).join(', ')),
    ...recurrenceLines(event.recurrence),
    `Link: ${event.htmlLink}`,
    `ID: ${event.id}`,
    `Calendar: ${event.calendarId}`,
  ].join('\n');

export const formatEventDetail = (event: CalendarEvent): string => {
  switch (event.status) {
    case 'confirmed':
    case 'tentative':
      return activeDetail(event);
    case 'cancelled':
      return [`(cancelled)`, ...recurrenceLines(event.recurrence), `ID: ${event.id}`, `Calendar: ${event.calendarId}`].join('\n');
    default: {
      const _exhaustive: never = event;
      throw new Error(`unhandled event: ${JSON.stringify(_exhaustive)}`);
    }
  }
};
