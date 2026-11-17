import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { GoogleNotFoundError, GoogleResponseParseError, InvalidInputError } from '../errors';
import { createGoogleClient } from '../google-client';

import { createCalendarService } from './index';

import type { EventTime, ListEventsInput, UpdateEventInput } from './index';

type Captured = { url: URL; method: string; body: unknown };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Answers each request with the next canned response (the last one repeats) and records what was sent.
const serviceWith = (...responses: readonly (() => Response)[]) => {
  const calls: Captured[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: new URL(input instanceof Request ? input.url : `${input}`), method: init?.method ?? 'GET', body });
    const respond = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (respond === undefined) throw new Error('no canned response');
    return respond();
  };
  const client = createGoogleClient({ fetch, getAccessToken: () => okAsync('token') });
  return { service: createCalendarService({ client }), calls };
};

const BASE = 'https://www.googleapis.com/calendar/v3';

// What an event without any of the richer fields reads as (Google's documented defaults).
const readDefaults = {
  eventType: { kind: 'default' },
  reminders: { kind: 'default' },
  color: { kind: 'calendar' },
  visibility: 'default',
  transparency: 'opaque',
  guests: { canModify: false, canInviteOthers: true, canSeeOtherGuests: true },
  conference: { kind: 'none' },
  hangoutLink: '',
} as const;

// The richer create fields at the values the old tests implicitly used, and the bodies they produce.
const createDefaults = {
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

const createDefaultsBody = { reminders: { useDefault: true }, visibility: 'default', transparency: 'opaque', guestsCanModify: false, guestsCanInviteOthers: true, guestsCanSeeOtherGuests: true };

const noZone = { kind: 'none' } as const;
const tokyo = { kind: 'iana', name: 'Asia/Tokyo' } as const;
const dateTime = (value: string): EventTime => ({ kind: 'dateTime', dateTime: value, timeZone: noZone });
const date = (value: string): EventTime => ({ kind: 'date', date: value });

const expectInvalid = (error: Error, fragments: readonly string[]) => {
  expect(error).toBeInstanceOf(InvalidInputError);
  for (const fragment of fragments) expect(error.message).toContain(fragment);
};

describe('listCalendars', () => {
  it('GETs users/me/calendarList and normalizes each entry, naming absent zone and color', async () => {
    const { service, calls } = serviceWith(() =>
      json({
        kind: 'calendar#calendarList',
        etag: '"x"',
        items: [
          { kind: 'calendar#calendarListEntry', etag: '"e"', id: 'me@example.com', summary: 'Me', primary: true, accessRole: 'owner', timeZone: 'Asia/Tokyo', backgroundColor: '#9fe1e7' },
          { id: 'ja.japanese#holiday@group.v.calendar.google.com', summary: 'Holidays', accessRole: 'reader' },
        ],
      }),
    );

    const result = await service.listCalendars();

    expect(calls[0]?.method).toBe('GET');
    expect(`${calls[0]?.url.origin}${calls[0]?.url.pathname}`).toBe(`${BASE}/users/me/calendarList`);
    expect(result._unsafeUnwrap()).toEqual([
      { id: 'me@example.com', summary: 'Me', primary: true, accessRole: 'owner', timeZone: tokyo, backgroundColor: { kind: 'hex', hex: '#9fe1e7' } },
      { id: 'ja.japanese#holiday@group.v.calendar.google.com', summary: 'Holidays', primary: false, accessRole: 'reader', timeZone: noZone, backgroundColor: { kind: 'none' } },
    ]);
  });

  it('follows nextPageToken until the last page', async () => {
    const { service, calls } = serviceWith(
      () => json({ items: [{ id: 'a', summary: 'A', accessRole: 'owner' }], nextPageToken: 'p2' }),
      () => json({ items: [{ id: 'b', summary: 'B', accessRole: 'reader' }] }),
    );

    const result = await service.listCalendars();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.searchParams.has('pageToken')).toBe(false);
    expect(calls[1]?.url.searchParams.get('pageToken')).toBe('p2');
    expect(result._unsafeUnwrap().map((calendar) => calendar.id)).toEqual(['a', 'b']);
  });

  it('prefers the user-set summaryOverride over the calendar summary', async () => {
    const { service } = serviceWith(() => json({ items: [{ id: 'a', summary: 'Original', summaryOverride: 'Mine', accessRole: 'owner' }] }));

    const result = await service.listCalendars();

    expect(result._unsafeUnwrap()[0]?.summary).toBe('Mine');
  });
});

const timedEvent = {
  kind: 'calendar#event',
  etag: '"3"',
  id: 'evt1',
  status: 'confirmed',
  htmlLink: 'https://www.google.com/calendar/event?eid=x',
  created: '2026-11-01T00:00:00.000Z',
  updated: '2026-11-02T00:00:00.000Z',
  summary: 'Standup',
  description: 'Daily',
  location: 'Room 1',
  start: { dateTime: '2026-11-17T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
  end: { dateTime: '2026-11-17T10:30:00+09:00', timeZone: 'Asia/Tokyo' },
  attendees: [{ email: 'a@example.com', responseStatus: 'accepted', self: true }, { email: 'b@example.com' }],
  recurringEventId: 'rec1',
  originalStartTime: { dateTime: '2026-11-17T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
};

const bareEvent = {
  id: 'evt3',
  htmlLink: 'https://www.google.com/calendar/event?eid=y',
  created: '2026-11-01T00:00:00.000Z',
  updated: '2026-11-01T00:00:00.000Z',
  start: { dateTime: '2026-11-17T10:00:00Z' },
  end: { dateTime: '2026-11-17T11:00:00Z' },
};

describe('getEvent', () => {
  it('GETs the event from the primary calendar by default and normalizes a timed recurring instance', async () => {
    const { service, calls } = serviceWith(() => json(timedEvent));

    const result = await service.getEvent({ eventId: 'evt1' });

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/primary/events/evt1`);
    expect(result._unsafeUnwrap()).toEqual({
      status: 'confirmed',
      id: 'evt1',
      calendarId: 'primary',
      summary: 'Standup',
      description: 'Daily',
      location: 'Room 1',
      start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: tokyo },
      end: { kind: 'dateTime', dateTime: '2026-11-17T10:30:00+09:00', timeZone: tokyo },
      htmlLink: 'https://www.google.com/calendar/event?eid=x',
      attendees: [
        { email: 'a@example.com', responseStatus: 'accepted', optional: false },
        { email: 'b@example.com', responseStatus: 'needsAction', optional: false },
      ],
      recurrence: { kind: 'instance', recurringEventId: 'rec1', originalStartTime: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: tokyo } },
      ...readDefaults,
      created: '2026-11-01T00:00:00.000Z',
      updated: '2026-11-02T00:00:00.000Z',
    });
  });

  it('maps an all-day event to the date variant', async () => {
    const { service } = serviceWith(() => json({ ...bareEvent, start: { date: '2026-11-23' }, end: { date: '2026-11-24' } }));

    const event = (await service.getEvent({ eventId: 'evt3' }))._unsafeUnwrap();

    expect(event).toMatchObject({ start: { kind: 'date', date: '2026-11-23' }, end: { kind: 'date', date: '2026-11-24' } });
  });

  it('fills absent text, attendees, status, zone and recurrence with explicit empty values', async () => {
    const { service } = serviceWith(() => json(bareEvent));

    const event = (await service.getEvent({ eventId: 'evt3' }))._unsafeUnwrap();

    expect(event).toEqual({
      status: 'confirmed',
      id: 'evt3',
      calendarId: 'primary',
      summary: '',
      description: '',
      location: '',
      start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00Z', timeZone: noZone },
      end: { kind: 'dateTime', dateTime: '2026-11-17T11:00:00Z', timeZone: noZone },
      htmlLink: 'https://www.google.com/calendar/event?eid=y',
      attendees: [],
      recurrence: { kind: 'single' },
      ...readDefaults,
      created: '2026-11-01T00:00:00.000Z',
      updated: '2026-11-01T00:00:00.000Z',
    });
  });

  it('fills absent htmlLink, created and updated with empty strings instead of failing the whole page', async () => {
    const { service } = serviceWith(() => json({ id: 'evt5', start: { date: '2026-11-17' }, end: { date: '2026-11-18' } }));

    const event = (await service.getEvent({ eventId: 'evt5' }))._unsafeUnwrap();

    expect(event).toMatchObject({ status: 'confirmed', htmlLink: '', created: '', updated: '' });
  });

  it('maps a recurring master event to the series variant with its rules', async () => {
    const { service } = serviceWith(() => json({ ...bareEvent, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'] }));

    const event = (await service.getEvent({ eventId: 'evt3' }))._unsafeUnwrap();

    expect(event.recurrence).toEqual({ kind: 'series', rules: ['RRULE:FREQ=WEEKLY;BYDAY=MO'] });
  });

  it('maps a cancelled event to the cancelled variant carrying only its identity and recurrence', async () => {
    const { service } = serviceWith(() => json({ id: 'evt4_20261117', status: 'cancelled', recurringEventId: 'evt4', originalStartTime: { date: '2026-11-17' } }));

    const event = (await service.getEvent({ eventId: 'evt4_20261117' }))._unsafeUnwrap();

    expect(event).toEqual({
      status: 'cancelled',
      id: 'evt4_20261117',
      calendarId: 'primary',
      recurrence: { kind: 'instance', recurringEventId: 'evt4', originalStartTime: { kind: 'date', date: '2026-11-17' } },
    });
  });

  it('URL-encodes the calendarId and eventId in the path', async () => {
    const { service, calls } = serviceWith(() => json(timedEvent));

    const result = await service.getEvent({ calendarId: 'ja.japanese#holiday@group.v.calendar.google.com', eventId: 'a/b' });

    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/ja.japanese%23holiday%40group.v.calendar.google.com/events/a%2Fb');
    expect(result._unsafeUnwrap().calendarId).toBe('ja.japanese#holiday@group.v.calendar.google.com');
  });

  it.each([
    ['an event time with neither date nor dateTime', { ...timedEvent, start: {} }],
    ['an instance without originalStartTime', { ...bareEvent, recurringEventId: 'rec1' }],
  ])('fails with GoogleResponseParseError for %s', async (_label, body) => {
    const { service } = serviceWith(() => json(body));

    const result = await service.getEvent({ eventId: 'evt1' });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleResponseParseError);
  });

  it('passes GoogleNotFoundError through for a missing event', async () => {
    const { service } = serviceWith(() => json({ error: { code: 404, message: 'Not Found' } }, 404));

    const result = await service.getEvent({ eventId: 'gone' });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});

const listAll: ListEventsInput = { window: { kind: 'all' }, search: { kind: 'none' }, maxResults: 10, page: { kind: 'first' } };

describe('listEvents', () => {
  it('GETs expanded events ordered by start time with the window, search text and paging', async () => {
    const { service, calls } = serviceWith(() => json({ kind: 'calendar#events', items: [timedEvent], nextPageToken: 'next' }));

    const result = await service.listEvents({
      calendarId: 'team@example.com',
      window: { kind: 'between', timeMin: '2026-11-17T00:00:00+09:00', timeMax: '2026-11-18T00:00:00+09:00' },
      search: { kind: 'text', text: 'standup' },
      maxResults: 50,
      page: { kind: 'next', pageToken: 'tok' },
    });

    const url = calls[0]?.url;
    expect(calls[0]?.method).toBe('GET');
    expect(url?.pathname).toBe('/calendar/v3/calendars/team%40example.com/events');
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: '2026-11-17T00:00:00+09:00',
      timeMax: '2026-11-18T00:00:00+09:00',
      q: 'standup',
      maxResults: '50',
      pageToken: 'tok',
    });
    const page = result._unsafeUnwrap();
    expect(page.nextPage).toEqual({ kind: 'next', pageToken: 'next' });
    expect(page.events.map((event) => [event.id, event.calendarId])).toEqual([['evt1', 'team@example.com']]);
  });

  it('defaults to the primary calendar, sends only the required params and reports the last page', async () => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    const page = (await service.listEvents(listAll))._unsafeUnwrap();

    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/primary/events');
    expect([...(calls[0]?.url.searchParams.keys() ?? [])]).toEqual(['singleEvents', 'orderBy', 'maxResults']);
    expect(page).toEqual({ events: [], nextPage: { kind: 'none' } });
  });

  it.each([
    [{ kind: 'from', timeMin: '2026-11-17T00:00:00+09:00' }, { timeMin: '2026-11-17T00:00:00+09:00' }],
    [{ kind: 'until', timeMax: '2026-11-18T00:00:00+09:00' }, { timeMax: '2026-11-18T00:00:00+09:00' }],
  ] satisfies readonly (readonly [ListEventsInput['window'], Readonly<Record<string, string>>])[])('sends only the bound a %o window has', async (window, expected) => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    await service.listEvents({ ...listAll, window });

    const params = Object.fromEntries(calls[0]?.url.searchParams ?? []);
    expect({ timeMin: params['timeMin'], timeMax: params['timeMax'] }).toEqual({ timeMin: undefined, timeMax: undefined, ...expected });
  });

  it('accepts a window whose bounds use different offsets but are correctly ordered', async () => {
    const { service } = serviceWith(() => json({ items: [] }));

    const result = await service.listEvents({ ...listAll, window: { kind: 'between', timeMin: '2026-11-17T10:00:00+09:00', timeMax: '2026-11-17T02:00:00Z' } });

    expect(result.isOk()).toBe(true);
  });

  it.each([
    ['timeMin', { kind: 'from', timeMin: '2026-11-17T10:00:00' }, '2026-11-17T10:00:00'],
    ['timeMax', { kind: 'until', timeMax: '2026-11-17' }, '2026-11-17'],
    ['timeMin', { kind: 'between', timeMin: '2026-02-30T10:00:00+09:00', timeMax: '2026-03-01T10:00:00+09:00' }, '2026-02-30T10:00:00+09:00'],
  ] satisfies readonly (readonly [string, ListEventsInput['window'], string])[])('rejects a %s that is not RFC 3339 with an offset before calling Google', async (field, window, value) => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    const error = (await service.listEvents({ ...listAll, window }))._unsafeUnwrapErr();

    expectInvalid(error, [field, `"${value}"`, 'RFC 3339', '+09:00']);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['equal', '2026-11-17T10:00:00+09:00', '2026-11-17T10:00:00+09:00'],
    ['reversed', '2026-11-17T10:00:00+09:00', '2026-11-17T00:59:59Z'],
  ])('rejects a %s window (timeMin must be before timeMax)', async (_label, timeMin, timeMax) => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    const error = (await service.listEvents({ ...listAll, window: { kind: 'between', timeMin, timeMax } }))._unsafeUnwrapErr();

    expectInvalid(error, [timeMin, timeMax, 'before']);
    expect(calls).toHaveLength(0);
  });

  it.each([0, 2501, 1.5])('rejects maxResults %s outside 1..2500', async (maxResults) => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    const error = (await service.listEvents({ ...listAll, maxResults }))._unsafeUnwrapErr();

    expectInvalid(error, [`${maxResults}`, '2500']);
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty search text and points at { kind: "none" }', async () => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    const error = (await service.listEvents({ ...listAll, search: { kind: 'text', text: '' } }))._unsafeUnwrapErr();

    expectInvalid(error, ['search.text', "kind: 'none'"]);
    expect(calls).toHaveLength(0);
  });
});

describe('createEvent', () => {
  it('POSTs a timed event with Google {dateTime, timeZone} times and returns the created event', async () => {
    const { service, calls } = serviceWith(() => json(timedEvent));

    const result = await service.createEvent({
      summary: 'Standup',
      description: 'Daily',
      location: 'Room 1',
      start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: tokyo },
      end: dateTime('2026-11-17T10:30:00+09:00'),
      attendees: [
        { email: 'a@example.com', optional: false },
        { email: 'b@example.com', optional: false },
      ],
      ...createDefaults,
    });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/primary/events?sendUpdates=none`);
    expect(calls[0]?.body).toEqual({
      ...createDefaultsBody,
      summary: 'Standup',
      description: 'Daily',
      location: 'Room 1',
      start: { dateTime: '2026-11-17T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
      end: { dateTime: '2026-11-17T10:30:00+09:00' },
      attendees: [
        { email: 'a@example.com', optional: false },
        { email: 'b@example.com', optional: false },
      ],
    });
    expect(result._unsafeUnwrap()).toMatchObject({ id: 'evt1', calendarId: 'primary' });
  });

  it('POSTs a one-day all-day event as Google {date} times with an exclusive end date', async () => {
    const { service, calls } = serviceWith(() => json({ ...bareEvent, start: { date: '2026-11-17' }, end: { date: '2026-11-18' } }));

    const result = await service.createEvent({
      calendarId: 'team@example.com',
      summary: 'Off',
      description: '',
      location: '',
      start: date('2026-11-17'),
      end: date('2026-11-18'),
      attendees: [],
      ...createDefaults,
    });

    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/team%40example.com/events');
    expect(calls[0]?.body).toEqual({ summary: 'Off', description: '', location: '', start: { date: '2026-11-17' }, end: { date: '2026-11-18' }, attendees: [], ...createDefaultsBody });
    expect(result._unsafeUnwrap()).toMatchObject({ calendarId: 'team@example.com', start: { kind: 'date', date: '2026-11-17' } });
  });

  it('accepts a timed range whose end uses a different offset but is later', async () => {
    const { service } = serviceWith(() => json(timedEvent));

    const result = await service.createEvent({
      summary: 'x',
      description: '',
      location: '',
      start: dateTime('2026-11-17T10:00:00+09:00'),
      end: dateTime('2026-11-17T02:00:00Z'),
      attendees: [],
      ...createDefaults,
    });

    expect(result.isOk()).toBe(true);
  });

  it.each([
    ['a start dateTime without an offset', dateTime('2026-11-17T10:00:00'), dateTime('2026-11-17T11:00:00+09:00'), ['start.dateTime', '"2026-11-17T10:00:00"', 'RFC 3339', '+09:00']],
    ['an end dateTime with an out-of-range hour', dateTime('2026-11-17T10:00:00+09:00'), dateTime('2026-11-17T25:00:00+09:00'), ['end.dateTime', '"2026-11-17T25:00:00+09:00"', 'RFC 3339']],
    ['a malformed start date', date('2026/11/17'), date('2026-11-18'), ['start.date', '"2026/11/17"', 'YYYY-MM-DD']],
    ['a non-existent end date', date('2026-11-17'), date('2026-11-31'), ['end.date', '"2026-11-31"', 'YYYY-MM-DD']],
    ['an end equal to the start', dateTime('2026-11-17T10:00:00+09:00'), dateTime('2026-11-17T01:00:00Z'), ['"2026-11-17T01:00:00Z"', '"2026-11-17T10:00:00+09:00"', 'after']],
    ['an end before the start', dateTime('2026-11-17T10:00:00+09:00'), dateTime('2026-11-17T09:00:00+09:00'), ['"2026-11-17T09:00:00+09:00"', 'after']],
    ['an all-day end equal to the start', date('2026-11-17'), date('2026-11-17'), ['"2026-11-17"', 'exclusive', '"2026-11-18"']],
    ['an all-day start with a timed end', date('2026-11-17'), dateTime('2026-11-17T10:00:00+09:00'), ['all-day', '"2026-11-17"', '"2026-11-17T10:00:00+09:00"', 'same kind']],
    ['a timed start with an all-day end', dateTime('2026-11-17T10:00:00+09:00'), date('2026-11-18'), ['all-day', 'same kind']],
    [
      'an unknown time zone',
      { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: { kind: 'iana', name: 'Tokyo' } },
      dateTime('2026-11-17T11:00:00+09:00'),
      ['start.timeZone', '"Tokyo"', 'IANA', 'Asia/Tokyo'],
    ],
  ] satisfies readonly (readonly [string, EventTime, EventTime, readonly string[]])[])('rejects %s before calling Google', async (_label, start, end, fragments) => {
    const { service, calls } = serviceWith(() => json(timedEvent));

    const error = (await service.createEvent({ summary: 'x', description: '', location: '', start, end, attendees: [], ...createDefaults }))._unsafeUnwrapErr();

    expectInvalid(error, fragments);
    expect(calls).toHaveLength(0);
  });
});

const keepAll: UpdateEventInput = {
  eventId: 'evt1',
  summary: { kind: 'keep' },
  description: { kind: 'keep' },
  location: { kind: 'keep' },
  attendees: { kind: 'keep' },
  time: { kind: 'keep' },
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
};

describe('updateEvent', () => {
  it('PATCHes only the fields that are set and returns the updated event', async () => {
    const { service, calls } = serviceWith(() => json(timedEvent));

    const result = await service.updateEvent({ ...keepAll, summary: { kind: 'set', value: 'Renamed' }, attendees: { kind: 'set', value: [{ email: 'c@example.com', optional: false }] } });

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/primary/events/evt1?sendUpdates=none`);
    expect(calls[0]?.body).toEqual({ summary: 'Renamed', attendees: [{ email: 'c@example.com', optional: false }] });
    expect(result._unsafeUnwrap()).toMatchObject({ id: 'evt1', calendarId: 'primary' });
  });

  it('clears text fields with an empty string and attendees with an empty list', async () => {
    const { service, calls } = serviceWith(() => json(timedEvent));

    await service.updateEvent({ ...keepAll, summary: { kind: 'clear' }, description: { kind: 'clear' }, location: { kind: 'clear' }, attendees: { kind: 'clear' } });

    expect(calls[0]?.body).toEqual({ summary: '', description: '', location: '', attendees: [] });
  });

  it('switches to an all-day range by nulling the timed fields Google would otherwise merge', async () => {
    const { service, calls } = serviceWith(() => json(timedEvent));

    await service.updateEvent({ ...keepAll, calendarId: 'team@example.com', time: { kind: 'set', start: date('2026-11-17'), end: date('2026-11-18') } });

    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/team%40example.com/events/evt1');
    expect(calls[0]?.body).toEqual({
      start: { date: '2026-11-17', dateTime: null, timeZone: null },
      end: { date: '2026-11-18', dateTime: null, timeZone: null },
    });
  });

  it('switches to a timed range by nulling the date, sending a given zone and leaving an unnamed zone untouched', async () => {
    const { service, calls } = serviceWith(() => json(timedEvent));

    await service.updateEvent({
      ...keepAll,
      time: { kind: 'set', start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: tokyo }, end: dateTime('2026-11-17T11:00:00+09:00') },
    });

    expect(calls[0]?.body).toEqual({
      start: { dateTime: '2026-11-17T10:00:00+09:00', timeZone: 'Asia/Tokyo', date: null },
      end: { dateTime: '2026-11-17T11:00:00+09:00', date: null },
    });
  });

  it.each([
    ['nothing to change', keepAll, ['no field', "kind: 'set'"]],
    ['an empty summary set', { ...keepAll, summary: { kind: 'set', value: '' } }, ['summary', "kind: 'clear'"]],
    ['an empty description set', { ...keepAll, description: { kind: 'set', value: '' } }, ['description', "kind: 'clear'"]],
    ['an empty location set', { ...keepAll, location: { kind: 'set', value: '' } }, ['location', "kind: 'clear'"]],
    ['an empty attendee list set', { ...keepAll, attendees: { kind: 'set', value: [] } }, ['attendees', "kind: 'clear'"]],
    ['an end before the start', { ...keepAll, time: { kind: 'set', start: dateTime('2026-11-17T10:00:00+09:00'), end: dateTime('2026-11-17T09:00:00+09:00') } }, ['after']],
    ['a mixed-kind range', { ...keepAll, time: { kind: 'set', start: date('2026-11-17'), end: dateTime('2026-11-17T10:00:00+09:00') } }, ['same kind']],
  ] satisfies readonly (readonly [string, UpdateEventInput, readonly string[]])[])('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json(timedEvent));

    const error = (await service.updateEvent(input))._unsafeUnwrapErr();

    expectInvalid(error, fragments);
    expect(calls).toHaveLength(0);
  });
});

describe('deleteEvent', () => {
  it('DELETEs the event and succeeds on 204', async () => {
    const { service, calls } = serviceWith(() => new Response(null, { status: 204 }));

    const result = await service.deleteEvent({ calendarId: 'a#b@c', eventId: 'evt1', sendUpdates: 'none' });

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/a%23b%40c/events/evt1?sendUpdates=none`);
    expect(result.isOk()).toBe(true);
  });

  it('fails with GoogleNotFoundError when the event is already gone (410)', async () => {
    const { service } = serviceWith(() => json({ error: { code: 410, message: 'Resource has been deleted' } }, 410));

    const result = await service.deleteEvent({ eventId: 'evt1', sendUpdates: 'none' });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNotFoundError);
  });
});

describe('queryFreeBusy', () => {
  it('POSTs freeBusy and returns busy intervals per calendar, separating per-calendar errors', async () => {
    const { service, calls } = serviceWith(() =>
      json({
        kind: 'calendar#freeBusy',
        timeMin: '2026-11-17T00:00:00.000Z',
        timeMax: '2026-11-18T00:00:00.000Z',
        calendars: {
          primary: { busy: [{ start: '2026-11-17T01:00:00Z', end: '2026-11-17T02:00:00Z' }] },
          'nobody@example.com': { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] },
        },
      }),
    );

    const result = await service.queryFreeBusy({ timeMin: '2026-11-17T09:00:00+09:00', timeMax: '2026-11-18T09:00:00+09:00', calendarIds: ['primary', 'nobody@example.com'] });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.href).toBe(`${BASE}/freeBusy`);
    expect(calls[0]?.body).toEqual({ timeMin: '2026-11-17T09:00:00+09:00', timeMax: '2026-11-18T09:00:00+09:00', items: [{ id: 'primary' }, { id: 'nobody@example.com' }] });
    expect(result._unsafeUnwrap()).toEqual({
      timeMin: '2026-11-17T00:00:00.000Z',
      timeMax: '2026-11-18T00:00:00.000Z',
      calendars: [
        { kind: 'ok', calendarId: 'primary', busy: [{ start: '2026-11-17T01:00:00Z', end: '2026-11-17T02:00:00Z' }] },
        { kind: 'error', calendarId: 'nobody@example.com', reasons: ['notFound'] },
      ],
    });
  });

  it.each([
    ['a timeMin without an offset', { timeMin: '2026-11-17T09:00:00', timeMax: '2026-11-18T09:00:00+09:00', calendarIds: ['primary'] }, ['timeMin', 'RFC 3339']],
    ['a reversed window', { timeMin: '2026-11-18T09:00:00+09:00', timeMax: '2026-11-17T09:00:00+09:00', calendarIds: ['primary'] }, ['before']],
    ['no calendars', { timeMin: '2026-11-17T09:00:00+09:00', timeMax: '2026-11-18T09:00:00+09:00', calendarIds: [] }, ['calendarIds', '1 to 50']],
    [
      'more than 50 calendars',
      { timeMin: '2026-11-17T09:00:00+09:00', timeMax: '2026-11-18T09:00:00+09:00', calendarIds: Array.from({ length: 51 }, (_, index) => `c${index}`) },
      ['calendarIds', '51', '1 to 50'],
    ],
  ])('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json({}));

    const error = (await service.queryFreeBusy(input))._unsafeUnwrapErr();

    expectInvalid(error, fragments);
    expect(calls).toHaveLength(0);
  });
});
