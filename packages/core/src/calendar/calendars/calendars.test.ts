import { describe, expect, it } from 'vitest';

import { BASE, expectInvalid, json, noContent, serviceWith } from '../test-support';

import type { UpdateCalendarInput } from '../index';

const wireCalendar = {
  kind: 'calendar#calendar',
  etag: '"e"',
  id: 'team@group.calendar.google.com',
  summary: 'Team',
  description: 'Shared',
  location: 'Tokyo',
  timeZone: 'Asia/Tokyo',
  dataOwner: 'me@example.com',
};

describe('getCalendar', () => {
  it('GETs calendars/{id} and normalizes the metadata', async () => {
    const { service, calls } = serviceWith(() => json(wireCalendar));

    const calendar = (await service.getCalendar({ calendarId: 'team@group.calendar.google.com' }))._unsafeUnwrap();

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/team%40group.calendar.google.com`);
    expect(calendar).toEqual({
      id: 'team@group.calendar.google.com',
      summary: 'Team',
      description: 'Shared',
      location: 'Tokyo',
      timeZone: { kind: 'iana', name: 'Asia/Tokyo' },
      dataOwner: { kind: 'email', email: 'me@example.com' },
    });
  });

  it('defaults to the primary calendar and names absent values', async () => {
    const { service, calls } = serviceWith(() => json({ id: 'me@example.com' }));

    const calendar = (await service.getCalendar({}))._unsafeUnwrap();

    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/primary');
    expect(calendar).toEqual({ id: 'me@example.com', summary: '', description: '', location: '', timeZone: { kind: 'none' }, dataOwner: { kind: 'none' } });
  });
});

describe('createCalendar', () => {
  it('POSTs calendars with the summary and the details that are set', async () => {
    const { service, calls } = serviceWith(() => json(wireCalendar));

    const calendar = (await service.createCalendar({ summary: 'Team', description: 'Shared', location: '', timeZone: { kind: 'iana', name: 'Asia/Tokyo' } }))._unsafeUnwrap();

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars`);
    expect(calls[0]?.body).toEqual({ summary: 'Team', description: 'Shared', timeZone: 'Asia/Tokyo' });
    expect(calendar.id).toBe('team@group.calendar.google.com');
  });

  it.each([
    ['an empty summary', { summary: ' ', description: '', location: '', timeZone: { kind: 'none' } as const }, ['summary', 'empty']],
    ['an unknown time zone', { summary: 'x', description: '', location: '', timeZone: { kind: 'iana', name: 'Tokyo' } as const }, ['timeZone', '"Tokyo"', 'IANA']],
  ])('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json(wireCalendar));

    expectInvalid((await service.createCalendar(input))._unsafeUnwrapErr(), fragments);
    expect(calls).toHaveLength(0);
  });
});

const keepAll: UpdateCalendarInput = { calendarId: 'c1', summary: { kind: 'keep' }, description: { kind: 'keep' }, location: { kind: 'keep' }, timeZone: { kind: 'keep' } };

describe('updateCalendar', () => {
  it('PATCHes only the fields that change, clearing text with an empty string', async () => {
    const { service, calls } = serviceWith(() => json(wireCalendar));

    await service.updateCalendar({ ...keepAll, summary: { kind: 'set', value: 'Renamed' }, description: { kind: 'clear' }, timeZone: { kind: 'set', value: 'Europe/Zurich' } });

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/c1`);
    expect(calls[0]?.body).toEqual({ summary: 'Renamed', description: '', timeZone: 'Europe/Zurich' });
  });

  it.each([
    ['nothing to change', keepAll, ['no field', 'summary']],
    ['an empty summary', { ...keepAll, summary: { kind: 'set', value: '' } }, ['summary', 'empty']],
    ['an empty location set', { ...keepAll, location: { kind: 'set', value: '' } }, ['location', "kind: 'clear'"]],
    ['an unknown time zone', { ...keepAll, timeZone: { kind: 'set', value: 'Mars/Base' } }, ['"Mars/Base"', 'IANA']],
  ] satisfies readonly (readonly [string, UpdateCalendarInput, readonly string[]])[])('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json(wireCalendar));

    expectInvalid((await service.updateCalendar(input))._unsafeUnwrapErr(), fragments);
    expect(calls).toHaveLength(0);
  });
});

describe('deleteCalendar', () => {
  it('DELETEs a secondary calendar', async () => {
    const { service, calls } = serviceWith(noContent);

    const result = await service.deleteCalendar({ calendarId: 'team@group.calendar.google.com' });

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/team%40group.calendar.google.com`);
    expect(result.isOk()).toBe(true);
  });

  it('rejects the primary calendar before calling Google and points at clear_calendar', async () => {
    const { service, calls } = serviceWith(noContent);

    expectInvalid((await service.deleteCalendar({ calendarId: 'primary' }))._unsafeUnwrapErr(), ['primary', 'cannot be deleted', 'clear_calendar', 'unsubscribe_calendar']);
    expect(calls).toHaveLength(0);
  });
});

describe('clearPrimaryCalendar', () => {
  it('POSTs calendars/primary/clear with no body', async () => {
    const { service, calls } = serviceWith(noContent);

    const result = await service.clearPrimaryCalendar();

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/primary/clear`);
    expect(calls[0]?.body).toBeUndefined();
    expect(result.isOk()).toBe(true);
  });
});
