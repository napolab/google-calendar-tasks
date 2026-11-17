import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { toCreateEventInput, toEventRef, toFreeBusyInput, toImportEventInput, toListEventInstancesInput, toListEventsInput, toUpdateEventInput } from './index';

import type { CreateEventArgs, UpdateEventArgs } from './index';

const REQUEST_ID = 'req-1';

const newRequestId = (): string => REQUEST_ID;

// What create_event fills in for the arguments it was not given.
const CREATE_DEFAULTS = {
  recurrence: [],
  reminders: { kind: 'default' },
  color: { kind: 'calendar' },
  visibility: 'default',
  transparency: 'opaque',
  guests: { canModify: false, canInviteOthers: true, canSeeOtherGuests: true },
  conference: { kind: 'none' },
  eventType: { kind: 'default' },
  sendUpdates: 'none',
} as const;

const UPDATE_KEEPS = {
  recurrence: { kind: 'keep' },
  reminders: { kind: 'keep' },
  color: { kind: 'keep' },
  visibility: { kind: 'keep' },
  transparency: { kind: 'keep' },
  guestsCanModify: { kind: 'keep' },
  guestsCanInviteOthers: { kind: 'keep' },
  guestsCanSeeOtherGuests: { kind: 'keep' },
  conference: { kind: 'keep' },
  statusProperties: { kind: 'keep' },
  sendUpdates: 'none',
} as const;

const timed = { kind: 'timed', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T11:00:00+09:00' } as const;

// 2026-11-17T12:34:56+09:00
const NOW = Date.UTC(2026, 10, 17, 3, 34, 56);

const messageOf = (result: { _unsafeUnwrapErr: () => Error }) => {
  const error = result._unsafeUnwrapErr();
  expect(error).toBeInstanceOf(InvalidInputError);
  return error.message;
};

describe('toEventRef', () => {
  it('defaults to the primary calendar by leaving calendarId out', () => {
    expect(toEventRef({ eventId: 'e1' })).toEqual({ eventId: 'e1' });
    expect(toEventRef({ eventId: 'e1', calendarId: 'work@group.calendar.google.com' })).toEqual({ eventId: 'e1', calendarId: 'work@group.calendar.google.com' });
  });
});

describe('toListEventsInput', () => {
  it('defaults to now → +7 days in Asia/Tokyo, 50 per page, no search, first page', () => {
    expect(toListEventsInput({}, NOW)._unsafeUnwrap()).toEqual({
      window: { kind: 'between', timeMin: '2026-11-17T12:34:56+09:00', timeMax: '2026-11-24T12:34:56+09:00' },
      search: { kind: 'none' },
      maxResults: 50,
      page: { kind: 'first' },
    });
  });

  it('reads dates as whole days (to inclusive) and passes the other arguments through', () => {
    expect(toListEventsInput({ calendarId: 'c1', from: '2026-11-20', to: '2026-11-21', query: 'standup', maxResults: 10, pageToken: 'p2' }, NOW)._unsafeUnwrap()).toEqual({
      calendarId: 'c1',
      window: { kind: 'between', timeMin: '2026-11-20T00:00:00+09:00', timeMax: '2026-11-22T00:00:00+09:00' },
      search: { kind: 'text', text: 'standup' },
      maxResults: 10,
      page: { kind: 'next', pageToken: 'p2' },
    });
  });

  it('defaults `to` to 7 days after `from`', () => {
    expect(toListEventsInput({ from: '2026-12-01T09:00:00+09:00' }, NOW)._unsafeUnwrap().window).toEqual({
      kind: 'between',
      timeMin: '2026-12-01T09:00:00+09:00',
      timeMax: '2026-12-08T09:00:00+09:00',
    });
  });

  it('rejects a malformed bound', () => {
    expect(messageOf(toListEventsInput({ from: 'next monday' }, NOW))).toContain('next monday');
  });

  it('rejects a window that ends before it starts', () => {
    const message = messageOf(toListEventsInput({ from: '2026-11-20', to: '2026-11-10' }, NOW));
    expect(message).toContain('to');
    expect(message).toContain('2026-11-10');
  });

  it('rejects an empty query', () => {
    expect(messageOf(toListEventsInput({ query: '' }, NOW))).toContain('query');
  });
});

describe('toCreateEventInput', () => {
  it('maps a one-day all-day event to Google’s exclusive end date', () => {
    expect(toCreateEventInput(newRequestId, { summary: 'Holiday', time: { kind: 'allDay', date: '2026-11-23' } })._unsafeUnwrap()).toEqual({
      summary: 'Holiday',
      description: '',
      location: '',
      start: { kind: 'date', date: '2026-11-23' },
      end: { kind: 'date', date: '2026-11-24' },
      attendees: [],
      ...CREATE_DEFAULTS,
    });
  });

  it('treats endDate as the inclusive last day', () => {
    const input = toCreateEventInput(newRequestId, { summary: 'Trip', time: { kind: 'allDay', date: '2026-11-23', endDate: '2026-11-25' } })._unsafeUnwrap();
    expect(input.end).toEqual({ kind: 'date', date: '2026-11-26' });
  });

  it('maps a timed event with its optional zone and the other fields', () => {
    expect(
      toCreateEventInput(newRequestId, {
        summary: 'Standup',
        calendarId: 'c1',
        description: 'daily',
        location: 'Room 1',
        attendees: ['a@example.com'],
        time: { kind: 'timed', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T10:15:00+09:00', timeZone: 'Asia/Tokyo' },
      })._unsafeUnwrap(),
    ).toEqual({
      calendarId: 'c1',
      summary: 'Standup',
      description: 'daily',
      location: 'Room 1',
      start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: { kind: 'iana', name: 'Asia/Tokyo' } },
      end: { kind: 'dateTime', dateTime: '2026-11-17T10:15:00+09:00', timeZone: { kind: 'iana', name: 'Asia/Tokyo' } },
      attendees: [{ email: 'a@example.com', optional: false }],
      ...CREATE_DEFAULTS,
    });
  });

  it('leaves the zone to the offset when timeZone is omitted', () => {
    const input = toCreateEventInput(newRequestId, { summary: 'x', time: { kind: 'timed', start: '2026-11-17T10:00:00Z', end: '2026-11-17T11:00:00Z' } })._unsafeUnwrap();
    expect(input.start).toEqual({ kind: 'dateTime', dateTime: '2026-11-17T10:00:00Z', timeZone: { kind: 'none' } });
  });

  it.each<[CreateEventArgs, string]>([
    [{ summary: '', time: { kind: 'allDay', date: '2026-11-23' } }, 'summary'],
    [{ summary: 'x', time: { kind: 'allDay', date: '2026-11-31' } }, '2026-11-31'],
    [{ summary: 'x', time: { kind: 'allDay', date: '2026-11-23', endDate: '2026-11-22' } }, 'endDate'],
    [{ summary: 'x', time: { kind: 'timed', start: '2026-11-17T10:00:00', end: '2026-11-17T11:00:00+09:00' } }, 'time.start'],
    [{ summary: 'x', time: { kind: 'timed', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T09:00:00+09:00' } }, 'time.end'],
    [{ summary: 'x', time: { kind: 'timed', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T11:00:00+09:00', timeZone: 'Tokyo' } }, 'Tokyo'],
    [{ summary: 'x', time: { kind: 'allDay', date: '2026-11-23' }, attendees: ['not-an-email'] }, 'not-an-email'],
  ])('rejects invalid input naming the offending value (%#)', (args, expected) => {
    expect(messageOf(toCreateEventInput(newRequestId, args))).toContain(expected);
  });
});

describe('toUpdateEventInput', () => {
  it('keeps every field that is not mentioned', () => {
    expect(toUpdateEventInput(newRequestId, { eventId: 'e1', summary: 'New' })._unsafeUnwrap()).toEqual({
      eventId: 'e1',
      summary: { kind: 'set', value: 'New' },
      description: { kind: 'keep' },
      location: { kind: 'keep' },
      attendees: { kind: 'keep' },
      time: { kind: 'keep' },
      ...UPDATE_KEEPS,
    });
  });

  it('sets, clears and moves', () => {
    expect(
      toUpdateEventInput(newRequestId, {
        eventId: 'e1',
        calendarId: 'c1',
        description: 'notes',
        clearLocation: true,
        attendees: ['b@example.com'],
        time: { kind: 'allDay', date: '2026-11-30' },
      })._unsafeUnwrap(),
    ).toEqual({
      calendarId: 'c1',
      eventId: 'e1',
      summary: { kind: 'keep' },
      description: { kind: 'set', value: 'notes' },
      location: { kind: 'clear' },
      attendees: { kind: 'set', value: [{ email: 'b@example.com', optional: false }] },
      time: { kind: 'set', start: { kind: 'date', date: '2026-11-30' }, end: { kind: 'date', date: '2026-12-01' } },
      ...UPDATE_KEEPS,
    });
  });

  it('clears the attendees', () => {
    expect(toUpdateEventInput(newRequestId, { eventId: 'e1', clearAttendees: true })._unsafeUnwrap().attendees).toEqual({ kind: 'clear' });
  });

  it('treats clearX: false as not clearing', () => {
    expect(messageOf(toUpdateEventInput(newRequestId, { eventId: 'e1', clearDescription: false }))).toContain('Nothing to update');
  });

  it.each<[UpdateEventArgs, string]>([
    [{ eventId: 'e1' }, 'Nothing to update'],
    [{ eventId: 'e1', description: 'x', clearDescription: true }, 'clearDescription'],
    [{ eventId: 'e1', location: '' }, 'clearLocation'],
    [{ eventId: 'e1', attendees: [] }, 'clearAttendees'],
    [{ eventId: 'e1', summary: '' }, 'summary'],
  ])('rejects an ambiguous patch (%#)', (args, expected) => {
    expect(messageOf(toUpdateEventInput(newRequestId, args))).toContain(expected);
  });
});

describe('toFreeBusyInput', () => {
  it('defaults to the primary calendar and reads dates as whole days', () => {
    expect(toFreeBusyInput({ from: '2026-11-17', to: '2026-11-18' })._unsafeUnwrap()).toEqual({
      timeMin: '2026-11-17T00:00:00+09:00',
      timeMax: '2026-11-19T00:00:00+09:00',
      calendarIds: ['primary'],
    });
  });

  it('passes the calendars through', () => {
    expect(toFreeBusyInput({ from: '2026-11-17T09:00:00+09:00', to: '2026-11-17T18:00:00+09:00', calendarIds: ['a', 'b'] })._unsafeUnwrap().calendarIds).toEqual(['a', 'b']);
  });

  it('rejects a reversed window', () => {
    expect(messageOf(toFreeBusyInput({ from: '2026-11-18', to: '2026-11-17' }))).toContain('2026-11-17');
  });
});

describe('toCreateEventInput rich fields', () => {
  it('maps optional attendees, recurrence, reminders, color, visibility, transparency, guest permissions, Meet and sendUpdates', () => {
    expect(
      toCreateEventInput(newRequestId, {
        summary: 'Weekly',
        time: { ...timed, timeZone: 'Asia/Tokyo' },
        attendees: ['a@example.com'],
        optionalAttendees: ['b@example.com'],
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
        reminders: { kind: 'custom', overrides: [{ method: 'popup', minutes: 10 }] },
        colorId: '5',
        visibility: 'private',
        transparency: 'transparent',
        guestsCanModify: true,
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
        addGoogleMeet: true,
        sendUpdates: 'all',
      })._unsafeUnwrap(),
    ).toMatchObject({
      attendees: [
        { email: 'a@example.com', optional: false },
        { email: 'b@example.com', optional: true },
      ],
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
      reminders: { kind: 'custom', overrides: [{ method: 'popup', minutes: 10 }] },
      color: { kind: 'color', colorId: '5' },
      visibility: 'private',
      transparency: 'transparent',
      guests: { canModify: true, canInviteOthers: false, canSeeOtherGuests: false },
      conference: { kind: 'meet', requestId: REQUEST_ID },
      sendUpdates: 'all',
    });
  });

  it('fills the focus time defaults and keeps it opaque', () => {
    expect(toCreateEventInput(newRequestId, { summary: 'Focus', time: timed, eventType: { kind: 'focusTime' } })._unsafeUnwrap()).toMatchObject({
      eventType: { kind: 'focusTime', properties: { autoDeclineMode: 'declineNone', declineMessage: '', chatStatus: 'available' } },
      transparency: 'opaque',
    });
  });

  it('maps out of office with its auto-decline settings', () => {
    expect(
      toCreateEventInput(newRequestId, {
        summary: 'OOO',
        time: timed,
        eventType: { kind: 'outOfOffice', autoDeclineMode: 'declineAllConflictingInvitations', declineMessage: 'Away' },
      })._unsafeUnwrap(),
    ).toMatchObject({ eventType: { kind: 'outOfOffice', properties: { autoDeclineMode: 'declineAllConflictingInvitations', declineMessage: 'Away' } } });
  });

  it.each([
    [{ type: 'homeOffice' } as const, { type: 'homeOffice' }],
    [{ type: 'officeLocation', label: 'HQ', buildingId: 'b1' } as const, { type: 'officeLocation', office: { label: 'HQ', buildingId: 'b1', floorId: '', floorSectionId: '', deskId: '' } }],
    [{ type: 'customLocation', label: 'Cafe' } as const, { type: 'customLocation', label: 'Cafe' }],
  ])('makes a working location %o public and transparent by default', (location, expected) => {
    expect(toCreateEventInput(newRequestId, { summary: 'Where', time: { kind: 'allDay', date: '2026-11-17' }, eventType: { kind: 'workingLocation', location } })._unsafeUnwrap()).toMatchObject({
      eventType: { kind: 'workingLocation', location: expected },
      visibility: 'public',
      transparency: 'transparent',
    });
  });

  it.each<[CreateEventArgs, string]>([
    [{ summary: 'x', time: timed, optionalAttendees: ['nope'] }, 'optionalAttendees'],
    [{ summary: 'x', time: timed, attendees: ['a@example.com'], optionalAttendees: ['a@example.com'] }, 'both'],
  ])('rejects bad guests (%#)', (args, expected) => {
    expect(messageOf(toCreateEventInput(newRequestId, args))).toContain(expected);
  });
});

describe('toUpdateEventInput rich fields', () => {
  it('maps the richer patches', () => {
    expect(
      toUpdateEventInput(newRequestId, {
        eventId: 'e1',
        attendees: ['a@example.com'],
        optionalAttendees: ['b@example.com'],
        recurrence: ['RRULE:FREQ=DAILY;COUNT=3'],
        reminders: { kind: 'default' },
        clearColor: true,
        visibility: 'public',
        transparency: 'opaque',
        guestsCanModify: false,
        addGoogleMeet: true,
        eventTypeProperties: { kind: 'focusTime', autoDeclineMode: 'declineNone', chatStatus: 'doNotDisturb' },
        sendUpdates: 'externalOnly',
      })._unsafeUnwrap(),
    ).toMatchObject({
      attendees: {
        kind: 'set',
        value: [
          { email: 'a@example.com', optional: false },
          { email: 'b@example.com', optional: true },
        ],
      },
      recurrence: { kind: 'set', value: ['RRULE:FREQ=DAILY;COUNT=3'] },
      reminders: { kind: 'set', value: { kind: 'default' } },
      color: { kind: 'clear' },
      visibility: { kind: 'set', value: 'public' },
      transparency: { kind: 'set', value: 'opaque' },
      guestsCanModify: { kind: 'set', value: false },
      guestsCanInviteOthers: { kind: 'keep' },
      conference: { kind: 'createMeet', requestId: REQUEST_ID },
      statusProperties: { kind: 'set', value: { kind: 'focusTime', properties: { autoDeclineMode: 'declineNone', declineMessage: '', chatStatus: 'doNotDisturb' } } },
      sendUpdates: 'externalOnly',
    });
  });

  it('removes the conference', () => {
    expect(toUpdateEventInput(newRequestId, { eventId: 'e1', removeConference: true })._unsafeUnwrap().conference).toEqual({ kind: 'remove' });
  });

  it('changes only the visibility (a rich field alone is a change)', () => {
    expect(toUpdateEventInput(newRequestId, { eventId: 'e1', visibility: 'private' }).isOk()).toBe(true);
  });

  it.each<[UpdateEventArgs, string]>([
    [{ eventId: 'e1', colorId: '3', clearColor: true }, 'clearColor'],
    [{ eventId: 'e1', addGoogleMeet: true, removeConference: true }, 'removeConference'],
    [{ eventId: 'e1', optionalAttendees: ['a@example.com'], clearAttendees: true }, 'clearAttendees'],
  ])('rejects contradicting arguments (%#)', (args, expected) => {
    expect(messageOf(toUpdateEventInput(newRequestId, args))).toContain(expected);
  });
});

describe('toListEventInstancesInput', () => {
  it('defaults to now → 90 days, 50 per page', () => {
    expect(toListEventInstancesInput({ eventId: 's1' }, NOW)._unsafeUnwrap()).toEqual({
      eventId: 's1',
      window: { kind: 'between', timeMin: '2026-11-17T12:34:56+09:00', timeMax: '2027-02-15T12:34:56+09:00' },
      maxResults: 50,
      page: { kind: 'first' },
    });
  });

  it('reads date bounds as whole days and passes paging through', () => {
    expect(toListEventInstancesInput({ eventId: 's1', calendarId: 'c1', from: '2026-12-01', to: '2026-12-31', maxResults: 10, pageToken: 'p2' }, NOW)._unsafeUnwrap()).toEqual({
      calendarId: 'c1',
      eventId: 's1',
      window: { kind: 'between', timeMin: '2026-12-01T00:00:00+09:00', timeMax: '2027-01-01T00:00:00+09:00' },
      maxResults: 10,
      page: { kind: 'next', pageToken: 'p2' },
    });
  });
});

describe('toImportEventInput', () => {
  it('maps the details with the iCalUID and no conference / notification fields', () => {
    expect(toImportEventInput({ iCalUID: 'u1', summary: 'X', time: { kind: 'allDay', date: '2026-11-23' }, optionalAttendees: ['b@example.com'] })._unsafeUnwrap()).toEqual({
      iCalUID: 'u1',
      summary: 'X',
      description: '',
      location: '',
      start: { kind: 'date', date: '2026-11-23' },
      end: { kind: 'date', date: '2026-11-24' },
      attendees: [{ email: 'b@example.com', optional: true }],
      recurrence: [],
      reminders: { kind: 'default' },
      color: { kind: 'calendar' },
      visibility: 'default',
      transparency: 'opaque',
      guests: { canModify: false, canInviteOthers: true, canSeeOtherGuests: true },
    });
  });
});
