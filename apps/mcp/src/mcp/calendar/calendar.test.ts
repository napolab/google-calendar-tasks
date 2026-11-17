import { GoogleNotFoundError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { GoogleNotConnectedError } from '../../errors';
import { createCalendarToolHandlers } from './index';

import type { ToolDeps } from '../tool-deps';
import type { ActiveEvent, ICalendarService } from '@napolab/gct-core/calendar';
import type { Services } from '@napolab/gct-core/services';
import type { ITasksService } from '@napolab/gct-core/tasks';

const NOW = Date.UTC(2026, 10, 17, 3, 0, 0);
const CONNECT_URL = 'https://gct.example.com/google/connect';

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
  created: '',
  updated: '2026-11-02T00:00:00Z',
};

const unexpected = () => {
  throw new Error('unexpected call');
};

const calendarWith = (overrides: Partial<ICalendarService>): ICalendarService => ({
  listCalendars: unexpected,
  listEvents: unexpected,
  getEvent: unexpected,
  createEvent: unexpected,
  updateEvent: unexpected,
  deleteEvent: unexpected,
  queryFreeBusy: unexpected,
  ...overrides,
});

const tasks: ITasksService = {
  listTaskLists: unexpected,
  getTaskList: unexpected,
  createTaskList: unexpected,
  renameTaskList: unexpected,
  deleteTaskList: unexpected,
  listTasks: unexpected,
  getTask: unexpected,
  createTask: unexpected,
  updateTask: unexpected,
  completeTask: unexpected,
  reopenTask: unexpected,
  deleteTask: unexpected,
};

const handlersWith = (overrides: Partial<ICalendarService>) => {
  const services: Services = { calendar: calendarWith(overrides), tasks };
  const deps: ToolDeps = { services, now: () => NOW, connectURL: CONNECT_URL };
  return createCalendarToolHandlers(deps);
};

const jsonOf = (result: { content: { text: string }[]; isError?: boolean }): unknown => {
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? '');
};

const errorTextOf = (result: { content: { text: string }[]; isError?: boolean }): string => {
  expect(result.isError).toBe(true);
  return result.content[0]?.text ?? '';
};

describe('calendar tools', () => {
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

  it('delete_event confirms what was deleted', async () => {
    const handlers = handlersWith({ deleteEvent: () => okAsync(undefined) });

    expect(jsonOf(await handlers.deleteEvent({ eventId: 'e1', calendarId: 'c1' }))).toEqual({ deleted: true, calendarId: 'c1', eventId: 'e1' });
    expect(jsonOf(await handlers.deleteEvent({ eventId: 'e1' }))).toEqual({ deleted: true, calendarId: 'primary', eventId: 'e1' });
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

  it('sends the user to the connect page when Google is not connected', async () => {
    const handlers = handlersWith({ listCalendars: () => errAsync(new GoogleNotConnectedError('not connected')) });

    expect(errorTextOf(await handlers.listCalendars())).toContain(CONNECT_URL);
  });

  it('maps Google errors to a next step', async () => {
    const handlers = handlersWith({ getEvent: () => errAsync(new GoogleNotFoundError('Google API 404: Not Found')) });

    expect(errorTextOf(await handlers.getEvent({ eventId: 'missing' }))).toContain('list_events');
  });
});
