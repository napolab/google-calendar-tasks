import { describe, expect, it } from 'vitest';

import { formatEventDetail, formatEventLine, formatEventPage, formatWhen } from './index';

import type { ActiveEvent, CancelledEvent } from '@napolab/gct-core/calendar';

const TIMED: ActiveEvent = {
  status: 'confirmed',
  id: 'ev1',
  calendarId: 'primary',
  summary: 'Design review',
  description: 'Agenda in doc',
  location: 'Room 1',
  start: { kind: 'dateTime', dateTime: '2026-11-17T01:00:00Z', timeZone: { kind: 'none' } },
  end: { kind: 'dateTime', dateTime: '2026-11-17T02:30:00Z', timeZone: { kind: 'none' } },
  htmlLink: 'https://calendar.google.com/event?eid=1',
  attendees: [{ email: 'a@example.com', responseStatus: 'accepted', optional: false }],
  recurrence: { kind: 'single' },
  eventType: { kind: 'default' },
  reminders: { kind: 'default' },
  color: { kind: 'calendar' },
  visibility: 'default',
  transparency: 'opaque',
  guests: { canModify: false, canInviteOthers: true, canSeeOtherGuests: true },
  conference: { kind: 'none' },
  hangoutLink: '',
  iCalUID: 'e1@google.com',
  created: '2026-11-01T00:00:00Z',
  updated: '2026-11-02T00:00:00Z',
};

const CANCELLED: CancelledEvent = { status: 'cancelled', id: 'ev2', calendarId: 'primary', recurrence: { kind: 'single' } };

describe('formatWhen', () => {
  it('shows a same-day timed event in Asia/Tokyo as one day with a time range', () => {
    expect(formatWhen(TIMED.start, TIMED.end)).toBe('2026-11-17 10:00–11:30');
  });

  it('shows both days when a timed event crosses midnight in Asia/Tokyo', () => {
    expect(formatWhen({ kind: 'dateTime', dateTime: '2026-11-17T14:00:00Z', timeZone: { kind: 'none' } }, { kind: 'dateTime', dateTime: '2026-11-17T16:00:00Z', timeZone: { kind: 'none' } })).toBe(
      '2026-11-17 23:00 – 2026-11-18 01:00',
    );
  });

  it('shows a one-day all-day event as that day (Google end is exclusive)', () => {
    expect(formatWhen({ kind: 'date', date: '2026-11-17' }, { kind: 'date', date: '2026-11-18' })).toBe('2026-11-17 (all day)');
  });

  it('shows a multi-day all-day event with its inclusive last day', () => {
    expect(formatWhen({ kind: 'date', date: '2026-11-17' }, { kind: 'date', date: '2026-11-20' })).toBe('2026-11-17 – 2026-11-19 (all day)');
  });
});

describe('formatEventLine', () => {
  it('shows when, title, location and id', () => {
    expect(formatEventLine(TIMED)).toBe('2026-11-17 10:00–11:30  Design review @ Room 1  [ev1]');
  });

  it('marks untitled and tentative events', () => {
    expect(formatEventLine({ ...TIMED, status: 'tentative', summary: '', location: '' })).toBe('2026-11-17 10:00–11:30  (no title) (tentative)  [ev1]');
  });

  it('shows a cancelled event by id', () => {
    expect(formatEventLine(CANCELLED)).toBe('(cancelled)  [ev2]');
  });
});

describe('formatEventPage', () => {
  it('lists events and how to get the next page', () => {
    expect(formatEventPage({ events: [TIMED], nextPage: { kind: 'next', pageToken: 'tok' } })).toBe('2026-11-17 10:00–11:30  Design review @ Room 1  [ev1]\nMore events: --page-token tok');
  });

  it('says when there are no events', () => {
    expect(formatEventPage({ events: [], nextPage: { kind: 'none' } })).toBe('No events.');
  });
});

describe('formatEventDetail', () => {
  it('shows every field of an active event', () => {
    const text = formatEventDetail({ ...TIMED, recurrence: { kind: 'series', rules: ['RRULE:FREQ=WEEKLY'] } });
    expect(text).toContain('Design review');
    expect(text).toContain('When: 2026-11-17 10:00–11:30');
    expect(text).toContain('Location: Room 1');
    expect(text).toContain('Agenda in doc');
    expect(text).toContain('a@example.com (accepted)');
    expect(text).toContain('Repeats: RRULE:FREQ=WEEKLY');
    expect(text).toContain('ID: ev1');
    expect(text).toContain('Calendar: primary');
    expect(text).toContain('https://calendar.google.com/event?eid=1');
  });

  it('omits empty fields', () => {
    const text = formatEventDetail({ ...TIMED, description: '', location: '', attendees: [] });
    expect(text).not.toContain('Location:');
    expect(text).not.toContain('Description:');
    expect(text).not.toContain('Attendees:');
  });

  it('shows a cancelled event', () => {
    expect(formatEventDetail(CANCELLED)).toContain('cancelled');
  });
});
