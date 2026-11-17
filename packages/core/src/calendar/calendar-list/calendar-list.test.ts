import { describe, expect, it } from 'vitest';

import { BASE, expectInvalid, json, noContent, queryOf, serviceWith } from '../test-support';

import type { UpdateCalendarListEntryInput } from '../index';

const wireEntry = {
  kind: 'calendar#calendarListEntry',
  etag: '"e"',
  id: 'team@group.calendar.google.com',
  summary: 'Team',
  summaryOverride: 'My team',
  description: 'Shared',
  location: 'Tokyo',
  timeZone: 'Asia/Tokyo',
  colorId: '14',
  backgroundColor: '#9fe1e7',
  foregroundColor: '#000000',
  hidden: true,
  selected: true,
  accessRole: 'writer',
  defaultReminders: [{ method: 'popup', minutes: 30 }],
  notificationSettings: { notifications: [{ method: 'email', type: 'eventCreation' }] },
  primary: false,
};

describe('getCalendarListEntry', () => {
  it('GETs users/me/calendarList/{id} and normalizes the display settings', async () => {
    const { service, calls } = serviceWith(() => json(wireEntry));

    const entry = (await service.getCalendarListEntry({ calendarId: 'team@group.calendar.google.com' }))._unsafeUnwrap();

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url.href).toBe(`${BASE}/users/me/calendarList/team%40group.calendar.google.com`);
    expect(entry).toEqual({
      id: 'team@group.calendar.google.com',
      summary: 'Team',
      summaryOverride: 'My team',
      description: 'Shared',
      location: 'Tokyo',
      timeZone: { kind: 'iana', name: 'Asia/Tokyo' },
      accessRole: 'writer',
      primary: false,
      hidden: true,
      selected: true,
      colorId: '14',
      backgroundColor: { kind: 'hex', hex: '#9fe1e7' },
      foregroundColor: { kind: 'hex', hex: '#000000' },
      defaultReminders: [{ method: 'popup', minutes: 30 }],
      notifications: ['eventCreation'],
    });
  });

  it('defaults to primary and names absent values', async () => {
    const { service, calls } = serviceWith(() => json({ id: 'me@example.com', accessRole: 'owner', primary: true }));

    const entry = (await service.getCalendarListEntry({}))._unsafeUnwrap();

    expect(calls[0]?.url.pathname).toBe('/calendar/v3/users/me/calendarList/primary');
    expect(entry).toMatchObject({ summary: '', summaryOverride: '', hidden: false, selected: false, colorId: '', backgroundColor: { kind: 'none' }, defaultReminders: [], notifications: [] });
  });
});

describe('subscribeCalendar', () => {
  it('POSTs users/me/calendarList with the id and no color', async () => {
    const { service, calls } = serviceWith(() => json(wireEntry));

    await service.subscribeCalendar({ calendarId: 'ja.japanese#holiday@group.v.calendar.google.com', color: { kind: 'default' } });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.href).toBe(`${BASE}/users/me/calendarList`);
    expect(calls[0]?.body).toEqual({ id: 'ja.japanese#holiday@group.v.calendar.google.com' });
  });

  it('sends RGB colors with colorRgbFormat=true', async () => {
    const { service, calls } = serviceWith(() => json(wireEntry));

    await service.subscribeCalendar({ calendarId: 'c1', color: { kind: 'rgb', background: '#0088aa', foreground: '#ffffff' } });

    expect(queryOf(calls[0])).toEqual({ colorRgbFormat: 'true' });
    expect(calls[0]?.body).toEqual({ id: 'c1', backgroundColor: '#0088aa', foregroundColor: '#ffffff' });
  });

  it('sends a palette color id without colorRgbFormat', async () => {
    const { service, calls } = serviceWith(() => json(wireEntry));

    await service.subscribeCalendar({ calendarId: 'c1', color: { kind: 'palette', colorId: '7' } });

    expect(queryOf(calls[0])).toEqual({});
    expect(calls[0]?.body).toEqual({ id: 'c1', colorId: '7' });
  });

  it.each([
    ['an empty id', { calendarId: '', color: { kind: 'default' } as const }, ['calendarId', 'empty']],
    ['a malformed hex color', { calendarId: 'c1', color: { kind: 'rgb', background: '0088aa', foreground: '#fff' } as const }, ['"0088aa"', '#RRGGBB']],
    ['an empty palette id', { calendarId: 'c1', color: { kind: 'palette', colorId: '' } as const }, ['colorId', 'get_colors']],
  ])('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json(wireEntry));

    expectInvalid((await service.subscribeCalendar(input))._unsafeUnwrapErr(), fragments);
    expect(calls).toHaveLength(0);
  });
});

const keepAll: UpdateCalendarListEntryInput = {
  calendarId: 'c1',
  summaryOverride: { kind: 'keep' },
  color: { kind: 'keep' },
  hidden: { kind: 'keep' },
  selected: { kind: 'keep' },
  defaultReminders: { kind: 'keep' },
  notifications: { kind: 'keep' },
};

describe('updateCalendarListEntry', () => {
  it('PATCHes the display settings that change', async () => {
    const { service, calls } = serviceWith(() => json(wireEntry));

    await service.updateCalendarListEntry({
      ...keepAll,
      summaryOverride: { kind: 'set', value: 'Mine' },
      hidden: { kind: 'set', value: false },
      selected: { kind: 'set', value: true },
      color: { kind: 'set', value: { kind: 'palette', colorId: '3' } },
      defaultReminders: { kind: 'set', value: [{ method: 'email', minutes: 60 }] },
      notifications: { kind: 'set', value: ['eventChange', 'agenda'] },
    });

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url.href).toBe(`${BASE}/users/me/calendarList/c1`);
    expect(calls[0]?.body).toEqual({
      summaryOverride: 'Mine',
      hidden: false,
      selected: true,
      colorId: '3',
      defaultReminders: [{ method: 'email', minutes: 60 }],
      notificationSettings: {
        notifications: [
          { method: 'email', type: 'eventChange' },
          { method: 'email', type: 'agenda' },
        ],
      },
    });
  });

  it('clears the name override with null and sets RGB colors with colorRgbFormat=true', async () => {
    const { service, calls } = serviceWith(() => json(wireEntry));

    await service.updateCalendarListEntry({ ...keepAll, summaryOverride: { kind: 'clear' }, color: { kind: 'set', value: { kind: 'rgb', background: '#112233', foreground: '#FFFFFF' } } });

    expect(queryOf(calls[0])).toEqual({ colorRgbFormat: 'true' });
    expect(calls[0]?.body).toEqual({ summaryOverride: null, backgroundColor: '#112233', foregroundColor: '#FFFFFF' });
  });

  it.each([
    ['nothing to change', keepAll, ['no field', 'summaryOverride']],
    ['an empty override', { ...keepAll, summaryOverride: { kind: 'set', value: '' } }, ['summaryOverride', "kind: 'clear'"]],
    ['a reminder over 4 weeks', { ...keepAll, defaultReminders: { kind: 'set', value: [{ method: 'popup', minutes: 50000 }] } }, ['50000', '40320']],
  ] satisfies readonly (readonly [string, UpdateCalendarListEntryInput, readonly string[]])[])('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json(wireEntry));

    expectInvalid((await service.updateCalendarListEntry(input))._unsafeUnwrapErr(), fragments);
    expect(calls).toHaveLength(0);
  });
});

describe('unsubscribeCalendar', () => {
  it('DELETEs the calendar list entry', async () => {
    const { service, calls } = serviceWith(noContent);

    const result = await service.unsubscribeCalendar({ calendarId: 'c1' });

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url.href).toBe(`${BASE}/users/me/calendarList/c1`);
    expect(result.isOk()).toBe(true);
  });

  it('rejects the primary calendar before calling Google', async () => {
    const { service, calls } = serviceWith(noContent);

    expectInvalid((await service.unsubscribeCalendar({ calendarId: 'primary' }))._unsafeUnwrapErr(), ['primary', 'cannot be removed']);
    expect(calls).toHaveLength(0);
  });
});
