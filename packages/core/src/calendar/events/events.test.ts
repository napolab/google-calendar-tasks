import { describe, expect, it } from 'vitest';

import { BASE, expectInvalid, json, noContent, queryOf, serviceWith } from '../test-support';

import type { CreateEventInput, EventTime, ImportEventInput, UpdateEventInput } from '../index';

const tokyo = { kind: 'iana', name: 'Asia/Tokyo' } as const;
const timed = (value: string): EventTime => ({ kind: 'dateTime', dateTime: value, timeZone: { kind: 'none' } });
const date = (value: string): EventTime => ({ kind: 'date', date: value });

const wireEvent = {
  id: 'evt1',
  start: { dateTime: '2026-11-17T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
  end: { dateTime: '2026-11-17T11:00:00+09:00', timeZone: 'Asia/Tokyo' },
};

const baseCreate: CreateEventInput = {
  summary: 'Plan',
  description: '',
  location: '',
  start: timed('2026-11-17T10:00:00+09:00'),
  end: timed('2026-11-17T11:00:00+09:00'),
  attendees: [],
  recurrence: [],
  reminders: { kind: 'default' },
  color: { kind: 'calendar' },
  visibility: 'default',
  transparency: 'opaque',
  guests: { canModify: false, canInviteOthers: true, canSeeOtherGuests: true },
  conference: { kind: 'none' },
  eventType: { kind: 'default' },
  sendUpdates: 'none',
};

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

describe('event fields on read', () => {
  it('fills Google defaults for absent reminders, color, visibility, transparency, guest permissions, type and conference', async () => {
    const { service } = serviceWith(() => json(wireEvent));

    const event = (await service.getEvent({ eventId: 'evt1' }))._unsafeUnwrap();

    expect(event).toMatchObject({
      eventType: { kind: 'default' },
      reminders: { kind: 'default' },
      color: { kind: 'calendar' },
      visibility: 'default',
      transparency: 'opaque',
      guests: { canModify: false, canInviteOthers: true, canSeeOtherGuests: true },
      conference: { kind: 'none' },
      hangoutLink: '',
      iCalUID: '',
    });
  });

  it('normalizes reminders, color, visibility, optional attendees and a Meet conference', async () => {
    const { service } = serviceWith(() =>
      json({
        ...wireEvent,
        colorId: '5',
        visibility: 'private',
        transparency: 'transparent',
        guestsCanModify: true,
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
        attendees: [{ email: 'a@example.com', optional: true }],
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
        conferenceData: {
          conferenceId: 'abc-defg-hij',
          conferenceSolution: { name: 'Google Meet', key: { type: 'hangoutsMeet' } },
          entryPoints: [
            { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij', label: 'meet.google.com/abc-defg-hij' },
            { entryPointType: 'phone', uri: 'tel:+81-3-0000-0000', label: '+81 3-0000-0000', pin: '123456' },
          ],
          createRequest: { requestId: 'r1', status: { statusCode: 'success' } },
        },
      }),
    );

    const event = (await service.getEvent({ eventId: 'evt1' }))._unsafeUnwrap();

    expect(event).toMatchObject({
      color: { kind: 'color', colorId: '5' },
      visibility: 'private',
      transparency: 'transparent',
      guests: { canModify: true, canInviteOthers: false, canSeeOtherGuests: false },
      reminders: { kind: 'custom', overrides: [{ method: 'popup', minutes: 10 }] },
      attendees: [{ email: 'a@example.com', responseStatus: 'needsAction', optional: true }],
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      conference: {
        kind: 'conference',
        status: 'success',
        conferenceId: 'abc-defg-hij',
        solution: 'Google Meet',
        entryPoints: [
          { type: 'video', uri: 'https://meet.google.com/abc-defg-hij', label: 'meet.google.com/abc-defg-hij', pin: '' },
          { type: 'phone', uri: 'tel:+81-3-0000-0000', label: '+81 3-0000-0000', pin: '123456' },
        ],
      },
    });
  });

  it('reports a conference that is still being created as pending', async () => {
    const { service } = serviceWith(() => json({ ...wireEvent, conferenceData: { createRequest: { requestId: 'r1', status: { statusCode: 'pending' } } } }));

    const event = (await service.getEvent({ eventId: 'evt1' }))._unsafeUnwrap();

    expect(event).toMatchObject({ conference: { kind: 'conference', status: 'pending', conferenceId: '', solution: '', entryPoints: [] } });
  });

  it.each([
    [
      'focus time',
      { eventType: 'focusTime', focusTimeProperties: { autoDeclineMode: 'declineOnlyNewConflictingInvitations', declineMessage: 'Focusing', chatStatus: 'doNotDisturb' } },
      { kind: 'focusTime', properties: { autoDeclineMode: 'declineOnlyNewConflictingInvitations', declineMessage: 'Focusing', chatStatus: 'doNotDisturb' } },
    ],
    ['focus time without properties', { eventType: 'focusTime' }, { kind: 'focusTime', properties: { autoDeclineMode: 'declineNone', declineMessage: '', chatStatus: 'available' } }],
    [
      'out of office',
      { eventType: 'outOfOffice', outOfOfficeProperties: { autoDeclineMode: 'declineAllConflictingInvitations', declineMessage: 'Away' } },
      { kind: 'outOfOffice', properties: { autoDeclineMode: 'declineAllConflictingInvitations', declineMessage: 'Away' } },
    ],
    ['working from home', { eventType: 'workingLocation', workingLocationProperties: { type: 'homeOffice', homeOffice: {} } }, { kind: 'workingLocation', location: { type: 'homeOffice' } }],
    [
      'working at an office',
      { eventType: 'workingLocation', workingLocationProperties: { type: 'officeLocation', officeLocation: { buildingId: 'b1', label: 'HQ' } } },
      { kind: 'workingLocation', location: { type: 'officeLocation', office: { label: 'HQ', buildingId: 'b1', floorId: '', floorSectionId: '', deskId: '' } } },
    ],
    [
      'working at a custom location',
      { eventType: 'workingLocation', workingLocationProperties: { type: 'customLocation', customLocation: { label: 'Cafe' } } },
      { kind: 'workingLocation', location: { type: 'customLocation', label: 'Cafe' } },
    ],
    ['a working location without properties', { eventType: 'workingLocation' }, { kind: 'workingLocation', location: { type: 'unknown' } }],
    ['a birthday', { eventType: 'birthday' }, { kind: 'birthday' }],
    ['an event from Gmail', { eventType: 'fromGmail' }, { kind: 'fromGmail' }],
  ])('maps %s to its event type variant', async (_label, wire, expected) => {
    const { service } = serviceWith(() => json({ ...wireEvent, ...wire }));

    const event = (await service.getEvent({ eventId: 'evt1' }))._unsafeUnwrap();

    expect(event).toMatchObject({ eventType: expected });
  });

  it('accepts the writerWithoutPrivateAccess access role in the calendar list', async () => {
    const { service } = serviceWith(() => json({ items: [{ id: 'c1', accessRole: 'writerWithoutPrivateAccess' }] }));

    const calendars = (await service.listCalendars())._unsafeUnwrap();

    expect(calendars[0]?.accessRole).toBe('writerWithoutPrivateAccess');
  });
});

describe('createEvent rich fields', () => {
  it('always sends sendUpdates, and the defaults it chose, without conference data or a type', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.createEvent(baseCreate);

    expect(queryOf(calls[0])).toEqual({ sendUpdates: 'none' });
    expect(calls[0]?.body).toEqual({
      summary: 'Plan',
      description: '',
      location: '',
      start: { dateTime: '2026-11-17T10:00:00+09:00' },
      end: { dateTime: '2026-11-17T11:00:00+09:00' },
      attendees: [],
      reminders: { useDefault: true },
      visibility: 'default',
      transparency: 'opaque',
      guestsCanModify: false,
      guestsCanInviteOthers: true,
      guestsCanSeeOtherGuests: true,
    });
  });

  it('sends recurrence, custom reminders, color, optional attendees, guest permissions and sendUpdates', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.createEvent({
      ...baseCreate,
      start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: tokyo },
      end: { kind: 'dateTime', dateTime: '2026-11-17T11:00:00+09:00', timeZone: tokyo },
      attendees: [
        { email: 'a@example.com', optional: false },
        { email: 'b@example.com', optional: true },
      ],
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4', 'EXDATE;TZID=Asia/Tokyo:20261124T100000', 'RDATE;VALUE=DATE:20261201'],
      reminders: {
        kind: 'custom',
        overrides: [
          { method: 'email', minutes: 1440 },
          { method: 'popup', minutes: 0 },
        ],
      },
      color: { kind: 'color', colorId: '11' },
      visibility: 'private',
      transparency: 'transparent',
      guests: { canModify: true, canInviteOthers: false, canSeeOtherGuests: false },
      sendUpdates: 'all',
    });

    expect(queryOf(calls[0])).toEqual({ sendUpdates: 'all' });
    expect(calls[0]?.body).toMatchObject({
      attendees: [
        { email: 'a@example.com', optional: false },
        { email: 'b@example.com', optional: true },
      ],
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4', 'EXDATE;TZID=Asia/Tokyo:20261124T100000', 'RDATE;VALUE=DATE:20261201'],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 1440 },
          { method: 'popup', minutes: 0 },
        ],
      },
      colorId: '11',
      visibility: 'private',
      transparency: 'transparent',
      guestsCanModify: true,
      guestsCanInviteOthers: false,
      guestsCanSeeOtherGuests: false,
    });
  });

  it('requests a Google Meet conference with conferenceDataVersion=1', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.createEvent({ ...baseCreate, conference: { kind: 'meet', requestId: 'req-1' } });

    expect(queryOf(calls[0])).toEqual({ sendUpdates: 'none', conferenceDataVersion: '1' });
    expect(calls[0]?.body).toMatchObject({ conferenceData: { createRequest: { requestId: 'req-1', conferenceSolutionKey: { type: 'hangoutsMeet' } } } });
  });

  it.each([
    [
      'focus time',
      { kind: 'focusTime', properties: { autoDeclineMode: 'declineOnlyNewConflictingInvitations', declineMessage: 'Focusing', chatStatus: 'doNotDisturb' } },
      { eventType: 'focusTime', focusTimeProperties: { autoDeclineMode: 'declineOnlyNewConflictingInvitations', declineMessage: 'Focusing', chatStatus: 'doNotDisturb' } },
    ],
    [
      'out of office (an empty decline message is not sent)',
      { kind: 'outOfOffice', properties: { autoDeclineMode: 'declineNone', declineMessage: '' } },
      { eventType: 'outOfOffice', outOfOfficeProperties: { autoDeclineMode: 'declineNone' } },
    ],
  ] satisfies readonly (readonly [string, CreateEventInput['eventType'], Readonly<Record<string, unknown>>])[])('creates a %s event', async (_label, eventType, expected) => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.createEvent({ ...baseCreate, eventType });

    expect(calls[0]?.body).toMatchObject({ ...expected, transparency: 'opaque' });
  });

  it.each([
    ['home office', { type: 'homeOffice' }, { type: 'homeOffice', homeOffice: {} }],
    [
      'an office',
      { type: 'officeLocation', office: { label: 'HQ', buildingId: 'b1', floorId: '', floorSectionId: '', deskId: '' } },
      { type: 'officeLocation', officeLocation: { label: 'HQ', buildingId: 'b1' } },
    ],
    ['a custom location', { type: 'customLocation', label: 'Cafe' }, { type: 'customLocation', customLocation: { label: 'Cafe' } }],
  ] as const)('creates an all-day working location event at %s', async (_label, location, expected) => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.createEvent({
      ...baseCreate,
      start: date('2026-11-17'),
      end: date('2026-11-18'),
      visibility: 'public',
      transparency: 'transparent',
      eventType: { kind: 'workingLocation', location },
    });

    expect(calls[0]?.body).toMatchObject({ eventType: 'workingLocation', workingLocationProperties: expected, visibility: 'public', transparency: 'transparent' });
  });

  const invalid: readonly (readonly [string, CreateEventInput, readonly string[]])[] = [
    ['a recurrence line with an unknown prefix', { ...baseCreate, recurrence: ['FREQ=DAILY'] }, ['recurrence[0]', '"FREQ=DAILY"', 'RRULE:']],
    ['a DTSTART recurrence line', { ...baseCreate, recurrence: ['DTSTART:20261117T100000Z'] }, ['recurrence[0]', 'DTSTART', 'start']],
    ['a timed recurring event without a time zone', { ...baseCreate, recurrence: ['RRULE:FREQ=DAILY'] }, ['time zone', 'recurring', 'Asia/Tokyo']],
    ['more than 5 reminders', { ...baseCreate, reminders: { kind: 'custom', overrides: Array.from({ length: 6 }, () => ({ method: 'popup' as const, minutes: 10 })) } }, ['6', 'at most 5']],
    ['a reminder over 4 weeks', { ...baseCreate, reminders: { kind: 'custom', overrides: [{ method: 'popup', minutes: 40321 }] } }, ['40321', '0 to 40320']],
    ['a fractional reminder', { ...baseCreate, reminders: { kind: 'custom', overrides: [{ method: 'popup', minutes: 1.5 }] } }, ['1.5', 'integer']],
    ['an unknown event color', { ...baseCreate, color: { kind: 'color', colorId: '12' } }, ['colorId "12"', '"1"', '"11"', 'get_colors']],
    ['an empty conference request id', { ...baseCreate, conference: { kind: 'meet', requestId: '' } }, ['requestId']],
    [
      'an all-day focus time event',
      {
        ...baseCreate,
        start: date('2026-11-17'),
        end: date('2026-11-18'),
        eventType: { kind: 'focusTime', properties: { autoDeclineMode: 'declineNone', declineMessage: '', chatStatus: 'available' } },
      },
      ['focusTime', 'all-day', 'timed'],
    ],
    [
      'an all-day out-of-office event',
      { ...baseCreate, start: date('2026-11-17'), end: date('2026-11-18'), eventType: { kind: 'outOfOffice', properties: { autoDeclineMode: 'declineNone', declineMessage: '' } } },
      ['outOfOffice', 'all-day', 'timed'],
    ],
    [
      'a transparent focus time event',
      { ...baseCreate, transparency: 'transparent', eventType: { kind: 'focusTime', properties: { autoDeclineMode: 'declineNone', declineMessage: '', chatStatus: 'available' } } },
      ['focusTime', 'transparency', '"opaque"'],
    ],
    [
      'a working location that is not public',
      { ...baseCreate, transparency: 'transparent', eventType: { kind: 'workingLocation', location: { type: 'homeOffice' } } },
      ['workingLocation', 'visibility', '"public"'],
    ],
    [
      'an opaque working location',
      { ...baseCreate, visibility: 'public', eventType: { kind: 'workingLocation', location: { type: 'homeOffice' } } },
      ['workingLocation', 'transparency', '"transparent"'],
    ],
    [
      'a multi-day all-day working location',
      {
        ...baseCreate,
        start: date('2026-11-17'),
        end: date('2026-11-19'),
        visibility: 'public',
        transparency: 'transparent',
        eventType: { kind: 'workingLocation', location: { type: 'homeOffice' } },
      },
      ['workingLocation', 'one day'],
    ],
  ];

  it.each(invalid)('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    const error = (await service.createEvent(input))._unsafeUnwrapErr();

    expectInvalid(error, fragments);
    expect(calls).toHaveLength(0);
  });
});

describe('updateEvent rich fields', () => {
  it('PATCHes only the new fields that are set, with sendUpdates', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.updateEvent({
      ...keepAll,
      recurrence: { kind: 'set', value: ['RRULE:FREQ=WEEKLY;UNTIL=20261231T000000Z'] },
      color: { kind: 'set', value: '3' },
      visibility: { kind: 'set', value: 'public' },
      transparency: { kind: 'set', value: 'transparent' },
      guestsCanModify: { kind: 'set', value: true },
      guestsCanSeeOtherGuests: { kind: 'set', value: false },
      attendees: { kind: 'set', value: [{ email: 'c@example.com', optional: true }] },
      sendUpdates: 'externalOnly',
    });

    expect(queryOf(calls[0])).toEqual({ sendUpdates: 'externalOnly' });
    expect(calls[0]?.body).toEqual({
      attendees: [{ email: 'c@example.com', optional: true }],
      recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20261231T000000Z'],
      colorId: '3',
      visibility: 'public',
      transparency: 'transparent',
      guestsCanModify: true,
      guestsCanSeeOtherGuests: false,
    });
  });

  it('switches reminders back to the calendar default by emptying the overrides PATCH would otherwise merge', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.updateEvent({ ...keepAll, reminders: { kind: 'set', value: { kind: 'default' } } });

    expect(calls[0]?.body).toEqual({ reminders: { useDefault: true, overrides: [] } });
  });

  it('clears the event color with null (back to the calendar color)', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.updateEvent({ ...keepAll, color: { kind: 'clear' } });

    expect(calls[0]?.body).toEqual({ colorId: null });
  });

  it('adds a Meet conference with conferenceDataVersion=1', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.updateEvent({ ...keepAll, conference: { kind: 'createMeet', requestId: 'req-2' } });

    expect(queryOf(calls[0])).toEqual({ sendUpdates: 'none', conferenceDataVersion: '1' });
    expect(calls[0]?.body).toEqual({ conferenceData: { createRequest: { requestId: 'req-2', conferenceSolutionKey: { type: 'hangoutsMeet' } } } });
  });

  it('removes the conference with conferenceData null and conferenceDataVersion=1', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.updateEvent({ ...keepAll, conference: { kind: 'remove' } });

    expect(queryOf(calls[0])).toEqual({ sendUpdates: 'none', conferenceDataVersion: '1' });
    expect(calls[0]?.body).toEqual({ conferenceData: null });
  });

  it('updates the status properties of a focus time event without resending its type', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.updateEvent({
      ...keepAll,
      statusProperties: { kind: 'set', value: { kind: 'focusTime', properties: { autoDeclineMode: 'declineNone', declineMessage: '', chatStatus: 'available' } } },
    });

    // PATCH merges nested objects: an empty decline message is sent so the stored one is replaced, not kept.
    expect(calls[0]?.body).toEqual({ focusTimeProperties: { autoDeclineMode: 'declineNone', declineMessage: '', chatStatus: 'available' } });
  });

  it('switches a working location type by nulling the other location variants PATCH would otherwise merge', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    await service.updateEvent({ ...keepAll, statusProperties: { kind: 'set', value: { kind: 'workingLocation', location: { type: 'customLocation', label: 'Cafe' } } } });

    expect(calls[0]?.body).toEqual({ workingLocationProperties: { type: 'customLocation', customLocation: { label: 'Cafe' }, homeOffice: null, officeLocation: null } });
  });

  it.each([
    ['nothing to change', keepAll, ['no field', 'recurrence', 'reminders']],
    ['an empty recurrence set', { ...keepAll, recurrence: { kind: 'set', value: [] } }, ['recurrence', 'UNTIL']],
    ['a malformed recurrence line', { ...keepAll, recurrence: { kind: 'set', value: ['RRULE FREQ=DAILY'] } }, ['recurrence[0]', 'RRULE:']],
    ['an unknown color', { ...keepAll, color: { kind: 'set', value: '0' } }, ['colorId "0"']],
    [
      'too many reminders',
      { ...keepAll, reminders: { kind: 'set', value: { kind: 'custom', overrides: Array.from({ length: 6 }, () => ({ method: 'email' as const, minutes: 5 })) } } },
      ['at most 5'],
    ],
  ] satisfies readonly (readonly [string, UpdateEventInput, readonly string[]])[])('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    const error = (await service.updateEvent(input))._unsafeUnwrapErr();

    expectInvalid(error, fragments);
    expect(calls).toHaveLength(0);
  });
});

describe('deleteEvent', () => {
  it('sends sendUpdates', async () => {
    const { service, calls } = serviceWith(noContent);

    await service.deleteEvent({ eventId: 'evt1', sendUpdates: 'all' });

    expect(calls[0]?.method).toBe('DELETE');
    expect(queryOf(calls[0])).toEqual({ sendUpdates: 'all' });
  });
});

describe('listEventInstances', () => {
  it('GETs the instances of a recurring event with the window and paging', async () => {
    const { service, calls } = serviceWith(() => json({ items: [{ ...wireEvent, id: 'evt1_20261117T010000Z', recurringEventId: 'evt1', originalStartTime: wireEvent.start }], nextPageToken: 'n2' }));

    const page = (
      await service.listEventInstances({
        calendarId: 'team@example.com',
        eventId: 'evt1',
        window: { kind: 'between', timeMin: '2026-11-17T00:00:00+09:00', timeMax: '2026-12-17T00:00:00+09:00' },
        maxResults: 25,
        page: { kind: 'next', pageToken: 'n1' },
      })
    )._unsafeUnwrap();

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/team%40example.com/events/evt1/instances');
    expect(queryOf(calls[0])).toEqual({ timeMin: '2026-11-17T00:00:00+09:00', timeMax: '2026-12-17T00:00:00+09:00', maxResults: '25', pageToken: 'n1' });
    expect(page.nextPage).toEqual({ kind: 'next', pageToken: 'n2' });
    expect(page.events.map((event) => [event.id, event.calendarId])).toEqual([['evt1_20261117T010000Z', 'team@example.com']]);
  });

  it('rejects a malformed window before calling Google', async () => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    const error = (await service.listEventInstances({ eventId: 'evt1', window: { kind: 'from', timeMin: '2026-11-17' }, maxResults: 10, page: { kind: 'first' } }))._unsafeUnwrapErr();

    expectInvalid(error, ['timeMin', 'RFC 3339']);
    expect(calls).toHaveLength(0);
  });
});

describe('moveEvent', () => {
  it('POSTs move with the destination and sendUpdates and returns the event on the destination calendar', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    const event = (await service.moveEvent({ eventId: 'evt1', destination: 'team@example.com', sendUpdates: 'none' }))._unsafeUnwrap();

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/primary/events/evt1/move');
    expect(queryOf(calls[0])).toEqual({ destination: 'team@example.com', sendUpdates: 'none' });
    expect(calls[0]?.body).toBeUndefined();
    expect(event.calendarId).toBe('team@example.com');
  });

  // Google's move response is the source copy, marked cancelled; the event lives on, confirmed, in the destination.
  it('re-reads the moved event from the destination calendar instead of returning the cancelled source copy', async () => {
    const { service, calls } = serviceWith(
      () => json({ id: 'evt1', status: 'cancelled' }),
      () => json({ ...wireEvent, status: 'confirmed', summary: 'Plan' }),
    );

    const event = (await service.moveEvent({ calendarId: 'a@example.com', eventId: 'evt1', destination: 'team@example.com', sendUpdates: 'none' }))._unsafeUnwrap();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe('GET');
    expect(calls[1]?.url.pathname).toBe('/calendar/v3/calendars/team%40example.com/events/evt1');
    expect(event).toMatchObject({
      status: 'confirmed',
      id: 'evt1',
      calendarId: 'team@example.com',
      summary: 'Plan',
      start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00' },
      end: { kind: 'dateTime', dateTime: '2026-11-17T11:00:00+09:00' },
    });
  });

  it.each([
    ['an empty destination', { eventId: 'evt1', destination: '', sendUpdates: 'none' as const }, ['destination', 'list_calendars']],
    ['the same calendar', { calendarId: 'a@example.com', eventId: 'evt1', destination: 'a@example.com', sendUpdates: 'none' as const }, ['destination', '"a@example.com"', 'already']],
  ])('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    expectInvalid((await service.moveEvent(input))._unsafeUnwrapErr(), fragments);
    expect(calls).toHaveLength(0);
  });
});

describe('quickAddEvent', () => {
  it('POSTs quickAdd with the text and sendUpdates and no body', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    const event = (await service.quickAddEvent({ calendarId: 'team@example.com', text: 'Lunch with Ann tomorrow 12pm', sendUpdates: 'none' }))._unsafeUnwrap();

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/team%40example.com/events/quickAdd');
    expect(queryOf(calls[0])).toEqual({ text: 'Lunch with Ann tomorrow 12pm', sendUpdates: 'none' });
    expect(calls[0]?.body).toBeUndefined();
    expect(event.calendarId).toBe('team@example.com');
  });

  it('rejects empty text before calling Google', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    expectInvalid((await service.quickAddEvent({ text: '  ', sendUpdates: 'none' }))._unsafeUnwrapErr(), ['text', 'empty']);
    expect(calls).toHaveLength(0);
  });
});

const baseImport: ImportEventInput = {
  iCalUID: 'abc123@example.com',
  summary: 'Imported',
  description: '',
  location: '',
  start: date('2026-11-17'),
  end: date('2026-11-18'),
  attendees: [],
  recurrence: [],
  reminders: { kind: 'default' },
  color: { kind: 'calendar' },
  visibility: 'default',
  transparency: 'opaque',
  guests: { canModify: false, canInviteOthers: true, canSeeOtherGuests: true },
};

describe('importEvent', () => {
  it('POSTs import with the iCalUID and the event details', async () => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    const event = (await service.importEvent(baseImport))._unsafeUnwrap();

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/primary/events/import`);
    expect(calls[0]?.body).toEqual({
      iCalUID: 'abc123@example.com',
      summary: 'Imported',
      description: '',
      location: '',
      start: { date: '2026-11-17' },
      end: { date: '2026-11-18' },
      attendees: [],
      reminders: { useDefault: true },
      visibility: 'default',
      transparency: 'opaque',
      guestsCanModify: false,
      guestsCanInviteOthers: true,
      guestsCanSeeOtherGuests: true,
    });
    expect(event.calendarId).toBe('primary');
  });

  it('returns the iCalUID Google stored for the imported event', async () => {
    const { service } = serviceWith(() => json({ ...wireEvent, iCalUID: 'abc123@example.com' }));

    expect((await service.importEvent(baseImport))._unsafeUnwrap()).toMatchObject({ iCalUID: 'abc123@example.com' });
  });

  it.each([
    ['an empty iCalUID', { ...baseImport, iCalUID: '' }, ['iCalUID', 'empty']],
    ['an end before the start', { ...baseImport, end: date('2026-11-16') }, ['end.date', 'after']],
    ['a bad recurrence line', { ...baseImport, recurrence: ['WEEKLY'] }, ['recurrence[0]']],
  ])('rejects %s before calling Google', async (_label, input, fragments) => {
    const { service, calls } = serviceWith(() => json(wireEvent));

    expectInvalid((await service.importEvent(input))._unsafeUnwrapErr(), fragments);
    expect(calls).toHaveLength(0);
  });
});
