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
      attendees: [{ email: 'a@example.com', responseStatus: 'accepted', optional: false }],
      recurrence: { kind: 'single' },
      eventType: { kind: 'default' },
      reminders: { kind: 'default' },
      colorId: null,
      visibility: 'default',
      transparency: 'opaque',
      guestsCanModify: false,
      guestsCanInviteOthers: true,
      guestsCanSeeOtherGuests: true,
      hangoutLink: null,
      conference: null,
      iCalUID: 'e1@google.com',
      updated: '2026-11-02T00:00:00Z',
    });
  });

  it('shows an all-day event with its inclusive last day', () => {
    const view = toEventView(active({ start: { kind: 'date', date: '2026-11-23' }, end: { kind: 'date', date: '2026-11-26' } }));
    expect(view).toMatchObject({ time: { kind: 'allDay', date: '2026-11-23', endDate: '2026-11-25' } });
  });

  it('shows no iCalUID as null', () => {
    expect(toEventView(active({ iCalUID: '' }))).toMatchObject({ iCalUID: null });
  });

  it('names the series of a recurring instance', () => {
    const view = toEventView(active({ recurrence: { kind: 'instance', recurringEventId: 'series-1', originalStartTime: { kind: 'date', date: '2026-11-17' } } }));
    expect(view).toMatchObject({ recurrence: { kind: 'instance', recurringEventId: 'series-1' } });
  });

  it('marks a cancelled event as deleted and says so', () => {
    const cancelled: CalendarEvent = { status: 'cancelled', id: 'e2', calendarId: 'primary', recurrence: { kind: 'single' } };
    expect(toEventView(cancelled)).toEqual({ id: 'e2', calendarId: 'primary', status: 'cancelled', deleted: true, recurrence: { kind: 'single' }, note: expect.stringContaining('deleted') });
  });

  it('explains a cancelled occurrence of a recurring series', () => {
    const cancelled: CalendarEvent = {
      status: 'cancelled',
      id: 'e2_20261117',
      calendarId: 'primary',
      recurrence: { kind: 'instance', recurringEventId: 'e2', originalStartTime: { kind: 'date', date: '2026-11-17' } },
    };
    expect(toEventView(cancelled)).toMatchObject({ deleted: true, recurrence: { kind: 'instance', recurringEventId: 'e2' }, note: expect.stringContaining('occurrence') });
  });
});

describe('toEventView rich fields', () => {
  it('shows color, reminders, the Meet link and the conference entry points', () => {
    const view = toEventView(
      active({
        color: { kind: 'color', colorId: '5' },
        reminders: { kind: 'custom', overrides: [{ method: 'email', minutes: 30 }] },
        hangoutLink: 'https://meet.google.com/abc',
        conference: {
          kind: 'conference',
          status: 'success',
          conferenceId: 'abc',
          solution: 'Google Meet',
          entryPoints: [{ type: 'video', uri: 'https://meet.google.com/abc', label: 'meet.google.com/abc', pin: '' }],
        },
      }),
    );
    expect(view).toMatchObject({
      colorId: '5',
      reminders: { kind: 'custom', overrides: [{ method: 'email', minutes: 30 }] },
      conference: {
        status: 'success',
        conferenceId: 'abc',
        solution: 'Google Meet',
        entryPoints: [{ type: 'video', uri: 'https://meet.google.com/abc', label: 'meet.google.com/abc', pin: null }],
      },
      hangoutLink: 'https://meet.google.com/abc',
    });
  });

  it('keeps a Meet link that arrives without conference data', () => {
    expect(toEventView(active({ hangoutLink: 'https://meet.google.com/xyz' }))).toMatchObject({ hangoutLink: 'https://meet.google.com/xyz', conference: null });
  });

  it.each([
    [
      { kind: 'focusTime', properties: { autoDeclineMode: 'declineNone', declineMessage: '', chatStatus: 'doNotDisturb' } },
      { kind: 'focusTime', autoDeclineMode: 'declineNone', declineMessage: null, chatStatus: 'doNotDisturb' },
    ],
    [
      { kind: 'outOfOffice', properties: { autoDeclineMode: 'declineAllConflictingInvitations', declineMessage: 'Away' } },
      { kind: 'outOfOffice', autoDeclineMode: 'declineAllConflictingInvitations', declineMessage: 'Away' },
    ],
    [
      { kind: 'workingLocation', location: { type: 'homeOffice' } },
      { kind: 'workingLocation', location: { type: 'homeOffice' } },
    ],
    [
      { kind: 'workingLocation', location: { type: 'officeLocation', office: { label: 'HQ', buildingId: 'b1', floorId: '', floorSectionId: '', deskId: '' } } },
      { kind: 'workingLocation', location: { type: 'officeLocation', label: 'HQ', buildingId: 'b1', floorId: null, floorSectionId: null, deskId: null } },
    ],
    [
      { kind: 'workingLocation', location: { type: 'customLocation', label: 'Cafe' } },
      { kind: 'workingLocation', location: { type: 'customLocation', label: 'Cafe' } },
    ],
    [
      { kind: 'workingLocation', location: { type: 'unknown' } },
      { kind: 'workingLocation', location: null },
    ],
    [{ kind: 'birthday' }, { kind: 'birthday' }],
  ] satisfies readonly (readonly [ActiveEvent['eventType'], unknown])[])('shows the event type %o in the shape create_event takes', (eventType, expected) => {
    expect(toEventView(active({ eventType }))).toMatchObject({ eventType: expected });
  });
});

describe('toEventPageView', () => {
  it('lists the events with the window used and the next page token', () => {
    const page = { events: [active({})], nextPage: { kind: 'next' as const, pageToken: 'p2' } };
    const view = toEventPageView({ calendarId: 'primary', window: { kind: 'between', timeMin: 'a', timeMax: 'b' } }, page);
    expect(view).toMatchObject({ calendarId: 'primary', window: { from: 'a', to: 'b' }, nextPageToken: 'p2' });
    expect(view.events).toHaveLength(1);
  });

  it('explains a cancelled occurrence among the listed events', () => {
    const cancelled: CalendarEvent = {
      status: 'cancelled',
      id: 's1_20261118',
      calendarId: 'primary',
      recurrence: { kind: 'instance', recurringEventId: 's1', originalStartTime: { kind: 'date', date: '2026-11-18' } },
    };
    const view = toEventPageView({ calendarId: 'primary', window: { kind: 'all' } }, { events: [active({}), cancelled], nextPage: { kind: 'none' } });
    expect(view.events[1]).toMatchObject({ id: 's1_20261118', status: 'cancelled', deleted: true, note: expect.stringContaining('occurrence') });
  });

  it('says null when there is no next page', () => {
    expect(toEventPageView({ calendarId: 'primary', window: { kind: 'all' } }, { events: [], nextPage: { kind: 'none' } }).nextPageToken).toBeNull();
  });
});
