import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { toCreateEventInput, toEventRef, toFreeBusyInput, toListEventsInput, toUpdateEventInput } from './index';

import type { CreateEventArgs, UpdateEventArgs } from './index';

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
    expect(toCreateEventInput({ summary: 'Holiday', time: { kind: 'allDay', date: '2026-11-23' } })._unsafeUnwrap()).toEqual({
      summary: 'Holiday',
      description: '',
      location: '',
      start: { kind: 'date', date: '2026-11-23' },
      end: { kind: 'date', date: '2026-11-24' },
      attendees: [],
    });
  });

  it('treats endDate as the inclusive last day', () => {
    const input = toCreateEventInput({ summary: 'Trip', time: { kind: 'allDay', date: '2026-11-23', endDate: '2026-11-25' } })._unsafeUnwrap();
    expect(input.end).toEqual({ kind: 'date', date: '2026-11-26' });
  });

  it('maps a timed event with its optional zone and the other fields', () => {
    expect(
      toCreateEventInput({
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
      attendees: ['a@example.com'],
    });
  });

  it('leaves the zone to the offset when timeZone is omitted', () => {
    const input = toCreateEventInput({ summary: 'x', time: { kind: 'timed', start: '2026-11-17T10:00:00Z', end: '2026-11-17T11:00:00Z' } })._unsafeUnwrap();
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
    expect(messageOf(toCreateEventInput(args))).toContain(expected);
  });
});

describe('toUpdateEventInput', () => {
  it('keeps every field that is not mentioned', () => {
    expect(toUpdateEventInput({ eventId: 'e1', summary: 'New' })._unsafeUnwrap()).toEqual({
      eventId: 'e1',
      summary: { kind: 'set', value: 'New' },
      description: { kind: 'keep' },
      location: { kind: 'keep' },
      attendees: { kind: 'keep' },
      time: { kind: 'keep' },
    });
  });

  it('sets, clears and moves', () => {
    expect(
      toUpdateEventInput({
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
      attendees: { kind: 'set', value: ['b@example.com'] },
      time: { kind: 'set', start: { kind: 'date', date: '2026-11-30' }, end: { kind: 'date', date: '2026-12-01' } },
    });
  });

  it('clears the attendees', () => {
    expect(toUpdateEventInput({ eventId: 'e1', clearAttendees: true })._unsafeUnwrap().attendees).toEqual({ kind: 'clear' });
  });

  it('treats clearX: false as not clearing', () => {
    expect(messageOf(toUpdateEventInput({ eventId: 'e1', clearDescription: false }))).toContain('Nothing to update');
  });

  it.each<[UpdateEventArgs, string]>([
    [{ eventId: 'e1' }, 'Nothing to update'],
    [{ eventId: 'e1', description: 'x', clearDescription: true }, 'clearDescription'],
    [{ eventId: 'e1', location: '' }, 'clearLocation'],
    [{ eventId: 'e1', attendees: [] }, 'clearAttendees'],
    [{ eventId: 'e1', summary: '' }, 'summary'],
  ])('rejects an ambiguous patch (%#)', (args, expected) => {
    expect(messageOf(toUpdateEventInput(args))).toContain(expected);
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
