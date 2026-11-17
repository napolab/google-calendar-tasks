import { GoogleNotFoundError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { GoogleNotConnectedError } from '../../../errors';
import { CONNECT_URL, depsWith, errorTextOf, jsonOf, recorder } from '../test-support';
import { createEventToolHandlers } from './index';

import type {
  ActiveEvent,
  CreateEventInput,
  DeleteEventInput,
  EventPage,
  ICalendarService,
  ImportEventInput,
  ListEventInstancesInput,
  MoveEventInput,
  QuickAddEventInput,
  UpdateEventInput,
} from '@napolab/gct-core/calendar';

const event: ActiveEvent = {
  status: 'confirmed',
  id: 'e1',
  calendarId: 'primary',
  summary: 'Standup',
  description: '',
  location: '',
  start: { kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00', timeZone: { kind: 'none' } },
  end: { kind: 'dateTime', dateTime: '2026-11-17T10:15:00+09:00', timeZone: { kind: 'none' } },
  htmlLink: '',
  attendees: [],
  recurrence: { kind: 'single' },
  eventType: { kind: 'default' },
  reminders: { kind: 'default' },
  color: { kind: 'calendar' },
  visibility: 'default',
  transparency: 'opaque',
  guests: { canModify: false, canInviteOthers: true, canSeeOtherGuests: true },
  conference: { kind: 'none' },
  hangoutLink: '',
  created: '',
  updated: '2026-11-02T00:00:00Z',
};

const handlersWith = (overrides: Partial<ICalendarService>) => createEventToolHandlers(depsWith(overrides));

describe('event tools', () => {
  it('list_calendars returns the normalized calendars', async () => {
    const handlers = handlersWith({
      listCalendars: () => okAsync([{ id: 'c1', summary: 'Work', primary: true, accessRole: 'owner', timeZone: { kind: 'none' }, backgroundColor: { kind: 'none' } }]),
    });

    expect(jsonOf(await handlers.listCalendars())).toEqual({ calendars: [{ id: 'c1', summary: 'Work', primary: true, accessRole: 'owner', timeZone: null }] });
  });

  it('list_events applies the defaults and reports the window it listed', async () => {
    const seen: unknown[] = [];
    const handlers = handlersWith({
      listEvents: (input) => {
        seen.push(input);
        return okAsync({ events: [event], nextPage: { kind: 'none' } });
      },
    });

    const body = jsonOf(await handlers.listEvents({}));

    expect(seen).toEqual([
      { window: { kind: 'between', timeMin: '2026-11-17T12:00:00+09:00', timeMax: '2026-11-24T12:00:00+09:00' }, search: { kind: 'none' }, maxResults: 50, page: { kind: 'first' } },
    ]);
    expect(body).toMatchObject({ calendarId: 'primary', window: { from: '2026-11-17T12:00:00+09:00', to: '2026-11-24T12:00:00+09:00' }, nextPageToken: null, events: [{ id: 'e1' }] });
  });

  it('rejects invalid input before calling Google', async () => {
    const handlers = handlersWith({});

    expect(errorTextOf(await handlers.createEvent({ summary: 'x', time: { kind: 'allDay', date: '2026-13-01' } }))).toContain('2026-13-01');
  });

  it('create_event / update_event / get_event return the normalized event', async () => {
    const handlers = handlersWith({ createEvent: () => okAsync(event), updateEvent: () => okAsync(event), getEvent: () => okAsync(event) });

    expect(jsonOf(await handlers.createEvent({ summary: 'Standup', time: { kind: 'timed', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T10:15:00+09:00' } }))).toMatchObject({
      id: 'e1',
      time: { kind: 'timed' },
    });
    expect(jsonOf(await handlers.updateEvent({ eventId: 'e1', summary: 'Standup' }))).toMatchObject({ id: 'e1' });
    expect(jsonOf(await handlers.getEvent({ eventId: 'e1' }))).toMatchObject({ id: 'e1' });
  });

  it('create_event sends no notification by default and asks for Meet with a fresh request id', async () => {
    const create = recorder((_input: CreateEventInput) => okAsync(event));
    const handlers = handlersWith({ createEvent: create.fn });

    await handlers.createEvent({ summary: 'A', time: { kind: 'timed', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T11:00:00+09:00' }, addGoogleMeet: true });
    await handlers.createEvent({ summary: 'B', time: { kind: 'timed', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T11:00:00+09:00' }, addGoogleMeet: true, sendUpdates: 'all' });

    const [first, second] = create.calls;
    expect(first?.sendUpdates).toBe('none');
    expect(second?.sendUpdates).toBe('all');
    expect(first?.conference).toMatchObject({ kind: 'meet', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(first?.conference).not.toEqual(second?.conference);
  });

  it('update_event sends no notification by default', async () => {
    const update = recorder((_input: UpdateEventInput) => okAsync(event));
    const handlers = handlersWith({ updateEvent: update.fn });

    await handlers.updateEvent({ eventId: 'e1', visibility: 'private' });

    expect(update.calls[0]).toMatchObject({ sendUpdates: 'none', visibility: { kind: 'set', value: 'private' } });
  });

  it('delete_event confirms what was deleted and sends no notification by default', async () => {
    const remove = recorder((_input: DeleteEventInput) => okAsync(undefined));
    const handlers = handlersWith({ deleteEvent: remove.fn });

    expect(jsonOf(await handlers.deleteEvent({ eventId: 'e1', calendarId: 'c1' }))).toEqual({ deleted: true, calendarId: 'c1', eventId: 'e1' });
    expect(jsonOf(await handlers.deleteEvent({ eventId: 'e1', sendUpdates: 'externalOnly' }))).toEqual({ deleted: true, calendarId: 'primary', eventId: 'e1' });
    expect(remove.calls).toEqual([
      { calendarId: 'c1', eventId: 'e1', sendUpdates: 'none' },
      { eventId: 'e1', sendUpdates: 'externalOnly' },
    ]);
  });

  it('query_freebusy returns busy intervals per calendar', async () => {
    const handlers = handlersWith({
      queryFreeBusy: (input) => okAsync({ timeMin: input.timeMin, timeMax: input.timeMax, calendars: [{ kind: 'ok', calendarId: 'primary', busy: [{ start: 's', end: 'e' }] }] }),
    });

    expect(jsonOf(await handlers.queryFreeBusy({ from: '2026-11-17', to: '2026-11-17' }))).toEqual({
      timeMin: '2026-11-17T00:00:00+09:00',
      timeMax: '2026-11-18T00:00:00+09:00',
      calendars: [{ kind: 'ok', calendarId: 'primary', busy: [{ start: 's', end: 'e' }] }],
    });
  });

  it('list_event_instances lists one series in a window that defaults to now → 90 days', async () => {
    const instances = recorder((_input: ListEventInstancesInput) => okAsync({ events: [event], nextPage: { kind: 'next', pageToken: 'p2' } } satisfies EventPage));
    const handlers = handlersWith({ listEventInstances: instances.fn });

    const body = jsonOf(await handlers.listEventInstances({ eventId: 'series1', calendarId: 'c1' }));

    expect(instances.calls).toEqual([
      { calendarId: 'c1', eventId: 'series1', window: { kind: 'between', timeMin: '2026-11-17T12:00:00+09:00', timeMax: '2027-02-15T12:00:00+09:00' }, maxResults: 50, page: { kind: 'first' } },
    ]);
    expect(body).toMatchObject({ calendarId: 'c1', recurringEventId: 'series1', nextPageToken: 'p2', events: [{ id: 'e1' }] });
  });

  it('move_event moves to the destination without notifying by default', async () => {
    const move = recorder((input: MoveEventInput) => okAsync({ ...event, calendarId: input.destination }));
    const handlers = handlersWith({ moveEvent: move.fn });

    expect(jsonOf(await handlers.moveEvent({ eventId: 'e1', destination: 'team@example.com' }))).toMatchObject({ id: 'e1', calendarId: 'team@example.com' });
    expect(move.calls).toEqual([{ eventId: 'e1', destination: 'team@example.com', sendUpdates: 'none' }]);
  });

  it('quick_add_event passes the text through and rejects an empty one', async () => {
    const quickAdd = recorder((_input: QuickAddEventInput) => okAsync(event));
    const handlers = handlersWith({ quickAddEvent: quickAdd.fn });

    expect(jsonOf(await handlers.quickAddEvent({ text: 'Lunch tomorrow 12pm', calendarId: 'c1' }))).toMatchObject({ id: 'e1' });
    expect(quickAdd.calls).toEqual([{ calendarId: 'c1', text: 'Lunch tomorrow 12pm', sendUpdates: 'none' }]);
    expect(errorTextOf(await handlers.quickAddEvent({ text: ' ' }))).toContain('text');
  });

  it('import_event maps the event details with the iCalUID', async () => {
    const importEvent = recorder((_input: ImportEventInput) => okAsync(event));
    const handlers = handlersWith({ importEvent: importEvent.fn });

    await handlers.importEvent({ iCalUID: 'uid-1@example.com', summary: 'Imported', time: { kind: 'allDay', date: '2026-11-23' } });

    expect(importEvent.calls[0]).toMatchObject({ iCalUID: 'uid-1@example.com', summary: 'Imported', start: { kind: 'date', date: '2026-11-23' }, end: { kind: 'date', date: '2026-11-24' } });
  });

  it('sends the user to the connect page when Google is not connected', async () => {
    const handlers = handlersWith({ listCalendars: () => errAsync(new GoogleNotConnectedError('not connected')) });

    expect(errorTextOf(await handlers.listCalendars())).toContain(CONNECT_URL);
  });

  it('maps Google errors to a next step', async () => {
    const handlers = handlersWith({ getEvent: () => errAsync(new GoogleNotFoundError('Google API 404: Not Found')) });

    expect(errorTextOf(await handlers.getEvent({ eventId: 'missing' }))).toContain('list_events');
  });
});
