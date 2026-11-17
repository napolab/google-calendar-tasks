import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { toCreateEventInput, toEventRef, toListEventsInput, toUpdateEventInput } from './index';

// 2026-11-17 10:00 in Asia/Tokyo.
const NOW = Date.UTC(2026, 10, 17, 1, 0, 0);

describe('toListEventsInput', () => {
  it('defaults to the next 7 days from now in Asia/Tokyo, the first page, no search', () => {
    expect(toListEventsInput({ max: 50 }, NOW)._unsafeUnwrap()).toEqual({
      window: { kind: 'between', timeMin: '2026-11-17T10:00:00+09:00', timeMax: '2026-11-24T10:00:00+09:00' },
      search: { kind: 'none' },
      maxResults: 50,
      page: { kind: 'first' },
    });
  });

  it('reads date-only bounds as whole Asia/Tokyo days, --to inclusive', () => {
    expect(toListEventsInput({ max: 50, from: '2026-11-20', to: '2026-11-21' }, NOW)._unsafeUnwrap().window).toEqual({
      kind: 'between',
      timeMin: '2026-11-20T00:00:00+09:00',
      timeMax: '2026-11-22T00:00:00+09:00',
    });
  });

  it('passes RFC 3339 bounds through and ends 7 days after --from when --to is absent', () => {
    expect(toListEventsInput({ max: 50, from: '2026-12-01T09:00:00+09:00' }, NOW)._unsafeUnwrap().window).toEqual({
      kind: 'between',
      timeMin: '2026-12-01T09:00:00+09:00',
      timeMax: '2026-12-08T09:00:00+09:00',
    });
  });

  it('maps --calendar, --search, --max and --page-token', () => {
    expect(toListEventsInput({ max: 10, calendar: 'team@group.calendar.google.com', search: 'standup', pageToken: 'tok' }, NOW)._unsafeUnwrap()).toMatchObject({
      calendarId: 'team@group.calendar.google.com',
      search: { kind: 'text', text: 'standup' },
      maxResults: 10,
      page: { kind: 'next', pageToken: 'tok' },
    });
  });

  it('rejects a bound in neither format', () => {
    const error = toListEventsInput({ max: 50, from: '2026-11-20 10:00' }, NOW)._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--from');
  });
});

describe('toCreateEventInput', () => {
  it('rejects --start without an offset before complaining about the missing --end', () => {
    const error = toCreateEventInput({ summary: 'x', start: '2026-11-17T10:00' })._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--start "2026-11-17T10:00"');
    expect(error.message).toContain('offset');
  });

  it('creates a one-day all-day event from --date (end is the exclusive next day)', () => {
    expect(toCreateEventInput({ summary: 'Holiday', date: '2026-11-23' })._unsafeUnwrap()).toEqual({
      summary: 'Holiday',
      description: '',
      location: '',
      start: { kind: 'date', date: '2026-11-23' },
      end: { kind: 'date', date: '2026-11-24' },
      attendees: [],
    });
  });

  it('treats --end-date as the inclusive last day', () => {
    expect(toCreateEventInput({ summary: 'Trip', date: '2026-11-23', endDate: '2026-11-25' })._unsafeUnwrap()).toMatchObject({
      start: { kind: 'date', date: '2026-11-23' },
      end: { kind: 'date', date: '2026-11-26' },
    });
  });

  it('rejects --end-date before --date', () => {
    const error = toCreateEventInput({ summary: 'Trip', date: '2026-11-23', endDate: '2026-11-22' })._unsafeUnwrapErr();
    expect(error.message).toContain('--end-date');
  });

  it('creates a timed event with an optional IANA zone and every optional field', () => {
    expect(
      toCreateEventInput({
        summary: 'Review',
        start: '2026-11-17T10:00:00+09:00',
        end: '2026-11-17T11:00:00+09:00',
        timeZone: 'Asia/Tokyo',
        description: 'Agenda',
        location: 'Room 1',
        attendee: ['a@example.com', 'b@example.com'],
        calendar: 'team@example.com',
      })._unsafeUnwrap(),
    ).toEqual({
      calendarId: 'team@example.com',
      summary: 'Review',
      description: 'Agenda',
      location: 'Room 1',
      start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: { kind: 'iana', name: 'Asia/Tokyo' } },
      end: { kind: 'dateTime', dateTime: '2026-11-17T11:00:00+09:00', timeZone: { kind: 'iana', name: 'Asia/Tokyo' } },
      attendees: ['a@example.com', 'b@example.com'],
    });
  });

  it('leaves the zone to the offset when --time-zone is absent', () => {
    expect(toCreateEventInput({ summary: 'x', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T11:00:00+09:00' })._unsafeUnwrap().start).toEqual({
      kind: 'dateTime',
      dateTime: '2026-11-17T10:00:00+09:00',
      timeZone: { kind: 'none' },
    });
  });

  it('rejects --start without --end', () => {
    const error = toCreateEventInput({ summary: 'x', start: '2026-11-17T10:00:00+09:00' })._unsafeUnwrapErr();
    expect(error.message).toContain('--end');
  });

  it('rejects mixing all-day and timed flags', () => {
    const error = toCreateEventInput({ summary: 'x', date: '2026-11-17', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T11:00:00+09:00' })._unsafeUnwrapErr();
    expect(error.message).toContain('--date');
    expect(error.message).toContain('--start');
  });

  it('rejects --end-date without --date', () => {
    expect(toCreateEventInput({ summary: 'x', endDate: '2026-11-17' })._unsafeUnwrapErr().message).toContain('--date');
  });

  it('requires a time', () => {
    const error = toCreateEventInput({ summary: 'x' })._unsafeUnwrapErr();
    expect(error.message).toContain('--date');
    expect(error.message).toContain('--start');
  });
});

describe('toUpdateEventInput', () => {
  it('maps set / clear / keep flags to patches', () => {
    expect(toUpdateEventInput('ev1', { summary: 'New', clearDescription: true, attendee: ['a@example.com'] })._unsafeUnwrap()).toEqual({
      eventId: 'ev1',
      summary: { kind: 'set', value: 'New' },
      description: { kind: 'clear' },
      location: { kind: 'keep' },
      attendees: { kind: 'set', value: ['a@example.com'] },
      time: { kind: 'keep' },
    });
  });

  it('moves the event when time flags are given', () => {
    expect(toUpdateEventInput('ev1', { date: '2026-11-20', calendar: 'c1' })._unsafeUnwrap()).toMatchObject({
      calendarId: 'c1',
      time: { kind: 'set', start: { kind: 'date', date: '2026-11-20' }, end: { kind: 'date', date: '2026-11-21' } },
    });
  });

  it('rejects --location together with --clear-location', () => {
    expect(toUpdateEventInput('ev1', { location: 'Room', clearLocation: true })._unsafeUnwrapErr().message).toContain('--clear-location');
  });

  it('rejects an empty --summary', () => {
    expect(toUpdateEventInput('ev1', { summary: '' })._unsafeUnwrapErr().message).toContain('--summary');
  });

  it('rejects an update that changes nothing, listing the flags', () => {
    const error = toUpdateEventInput('ev1', {})._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--summary');
    expect(error.message).toContain('--clear-description');
  });
});

describe('toEventRef', () => {
  it('omits the calendar unless given', () => {
    expect(toEventRef('ev1', {})).toEqual({ eventId: 'ev1' });
    expect(toEventRef('ev1', { calendar: 'c1' })).toEqual({ calendarId: 'c1', eventId: 'ev1' });
  });
});
