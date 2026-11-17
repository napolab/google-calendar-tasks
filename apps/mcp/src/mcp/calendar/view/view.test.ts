import { describe, expect, it } from 'vitest';

import { toCalendarView, toEventPageView, toEventView } from './index';

import type { ActiveEvent, CalendarEvent } from '@napolab/gct-core/calendar';

const active = (overrides: Partial<ActiveEvent>): ActiveEvent => ({
  status: 'confirmed',
  id: 'e1',
  calendarId: 'primary',
  summary: 'Standup',
  description: '',
  location: '',
  start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: { kind: 'iana', name: 'Asia/Tokyo' } },
  end: { kind: 'dateTime', dateTime: '2026-11-17T10:15:00+09:00', timeZone: { kind: 'iana', name: 'Asia/Tokyo' } },
  htmlLink: 'https://calendar.google.com/event?eid=1',
  attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }],
  recurrence: { kind: 'single' },
  created: '2026-11-01T00:00:00Z',
  updated: '2026-11-02T00:00:00Z',
  ...overrides,
});

describe('toCalendarView', () => {
  it('keeps the id and what helps choosing a calendar', () => {
    expect(toCalendarView({ id: 'c1', summary: 'Work', primary: false, accessRole: 'writer', timeZone: { kind: 'iana', name: 'Asia/Tokyo' }, backgroundColor: { kind: 'hex', hex: '#fff' } })).toEqual({
      id: 'c1',
      summary: 'Work',
      primary: false,
      accessRole: 'writer',
      timeZone: 'Asia/Tokyo',
    });
  });
});

describe('toEventView', () => {
  it('shows a timed event in the same shape create_event / update_event take', () => {
    expect(toEventView(active({}))).toEqual({
      id: 'e1',
      calendarId: 'primary',
      status: 'confirmed',
      summary: 'Standup',
      description: '',
      location: '',
      time: { kind: 'timed', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T10:15:00+09:00', timeZone: 'Asia/Tokyo' },
      attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }],
      recurrence: { kind: 'single' },
      updated: '2026-11-02T00:00:00Z',
    });
  });

  it('shows an all-day event with its inclusive last day', () => {
    const view = toEventView(active({ start: { kind: 'date', date: '2026-11-23' }, end: { kind: 'date', date: '2026-11-26' } }));
    expect(view).toMatchObject({ time: { kind: 'allDay', date: '2026-11-23', endDate: '2026-11-25' } });
  });

  it('names the series of a recurring instance', () => {
    const view = toEventView(active({ recurrence: { kind: 'instance', recurringEventId: 'series-1', originalStartTime: { kind: 'date', date: '2026-11-17' } } }));
    expect(view).toMatchObject({ recurrence: { kind: 'instance', recurringEventId: 'series-1' } });
  });

  it('keeps only the identity of a cancelled event', () => {
    const cancelled: CalendarEvent = { status: 'cancelled', id: 'e2', calendarId: 'primary', recurrence: { kind: 'single' } };
    expect(toEventView(cancelled)).toEqual({ id: 'e2', calendarId: 'primary', status: 'cancelled', recurrence: { kind: 'single' } });
  });
});

describe('toEventPageView', () => {
  it('lists the events with the window used and the next page token', () => {
    const page = { events: [active({})], nextPage: { kind: 'next' as const, pageToken: 'p2' } };
    const view = toEventPageView({ calendarId: 'primary', window: { kind: 'between', timeMin: 'a', timeMax: 'b' } }, page);
    expect(view).toMatchObject({ calendarId: 'primary', window: { from: 'a', to: 'b' }, nextPageToken: 'p2' });
    expect(view.events).toHaveLength(1);
  });

  it('says null when there is no next page', () => {
    expect(toEventPageView({ calendarId: 'primary', window: { kind: 'all' } }, { events: [], nextPage: { kind: 'none' } }).nextPageToken).toBeNull();
  });
});
