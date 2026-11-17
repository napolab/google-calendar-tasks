import { GoogleNotFoundError, InvalidInputError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeServices } from '../../test-support';

import { runCreateEvent, runDeleteEvent, runGetEvent, runListEvents, runUpdateEvent } from './index';

import type { ActiveEvent, CreateEventInput, DeleteEventInput, EventPage, EventRef, ListEventsInput, UpdateEventInput } from '@napolab/gct-core/calendar';

const EVENT: ActiveEvent = {
  status: 'confirmed',
  id: 'ev1',
  calendarId: 'primary',
  summary: 'Design review',
  description: '',
  location: '',
  start: { kind: 'dateTime', dateTime: '2026-11-17T01:00:00Z', timeZone: { kind: 'none' } },
  end: { kind: 'dateTime', dateTime: '2026-11-17T02:00:00Z', timeZone: { kind: 'none' } },
  htmlLink: 'https://calendar.google.com/event?eid=1',
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
  created: '2026-11-01T00:00:00Z',
  updated: '2026-11-02T00:00:00Z',
};

describe('runListEvents', () => {
  it('lists the default window and prints one line per event', async () => {
    const calls: ListEventsInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ calendar: { listEvents: (input) => (calls.push(input), okAsync({ events: [EVENT], nextPage: { kind: 'none' } })) } }) });
    await runListEvents(ctx, { max: 50 }, []);
    expect(calls[0]?.window).toEqual({ kind: 'between', timeMin: '2026-11-17T10:00:00+09:00', timeMax: '2026-11-24T10:00:00+09:00' });
    expect(ctx.output.stdout).toEqual(['2026-11-17 10:00–11:00  Design review  [ev1]']);
  });

  it('prints the core result with --json', async () => {
    const page: EventPage = { events: [EVENT], nextPage: { kind: 'none' } };
    const ctx = fakeContext({ services: fakeServices({ calendar: { listEvents: () => okAsync(page) } }) });
    await runListEvents(ctx, { max: 50, json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual(page);
  });

  it('tells a logged-out user to run gct login', async () => {
    const ctx = fakeContext();
    await runListEvents(ctx, { max: 50 }, []);
    expect(ctx.output.stderr.join('\n')).toContain('NotLoggedInError');
    expect(ctx.output.stderr.join('\n')).toContain('gct login');
    expect(ctx.output.failed()).toBe(true);
  });
});

describe('runCreateEvent', () => {
  it('reports a malformed --start before trying to connect', async () => {
    const ctx = fakeContext();
    await runCreateEvent(ctx, { summary: 'x', start: '2026-11-17T10:00' }, []);
    expect(ctx.output.stderr.join('\n')).toContain('InvalidInputError: --start "2026-11-17T10:00"');
    expect(ctx.output.failed()).toBe(true);
  });

  it('creates the event and prints it', async () => {
    const calls: CreateEventInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ calendar: { createEvent: (input) => (calls.push(input), okAsync(EVENT)) } }) });
    await runCreateEvent(ctx, { summary: 'Design review', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T11:00:00+09:00' }, []);
    expect(calls).toHaveLength(1);
    expect(ctx.output.stdout).toEqual(['Created: 2026-11-17 10:00–11:00  Design review  [ev1]']);
  });

  it('shows core input errors as they are', async () => {
    const ctx = fakeContext({ services: fakeServices({ calendar: { createEvent: () => errAsync(new InvalidInputError('timeZone "Mars/Base" is not an IANA time zone name')) } }) });
    await runCreateEvent(ctx, { summary: 'x', start: '2026-11-17T10:00:00+09:00', end: '2026-11-17T11:00:00+09:00', timeZone: 'Mars/Base' }, []);
    expect(ctx.output.stderr.join('\n')).toContain('InvalidInputError: timeZone "Mars/Base"');
  });
});

describe('runGetEvent', () => {
  it('prints the event detail', async () => {
    const refs: EventRef[] = [];
    const ctx = fakeContext({ services: fakeServices({ calendar: { getEvent: (ref) => (refs.push(ref), okAsync(EVENT)) } }) });
    await runGetEvent(ctx, { eventId: 'ev1' }, []);
    expect(refs).toEqual([{ eventId: 'ev1' }]);
    expect(ctx.output.stdout.join('\n')).toContain('ID: ev1');
  });

  it('fails with the Google error', async () => {
    const ctx = fakeContext({ services: fakeServices({ calendar: { getEvent: () => errAsync(new GoogleNotFoundError('Google API 404: Not Found')) } }) });
    await runGetEvent(ctx, { eventId: 'nope' }, []);
    expect(ctx.output.stderr).toEqual(['GoogleNotFoundError: Google API 404: Not Found']);
    expect(ctx.output.failed()).toBe(true);
  });
});

describe('runUpdateEvent', () => {
  it('sends the patch and prints the updated event', async () => {
    const calls: UpdateEventInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ calendar: { updateEvent: (input) => (calls.push(input), okAsync(EVENT)) } }) });
    await runUpdateEvent(ctx, { eventId: 'ev1', summary: 'Design review' }, []);
    expect(calls[0]?.summary).toEqual({ kind: 'set', value: 'Design review' });
    expect(ctx.output.stdout).toEqual(['Updated: 2026-11-17 10:00–11:00  Design review  [ev1]']);
  });

  it('rejects an update with no changes before connecting', async () => {
    const ctx = fakeContext();
    await runUpdateEvent(ctx, { eventId: 'ev1' }, []);
    expect(ctx.output.stderr.join('\n')).toContain('Nothing to update');
  });
});

describe('runDeleteEvent', () => {
  it('deletes and confirms', async () => {
    const refs: DeleteEventInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ calendar: { deleteEvent: (ref) => (refs.push(ref), okAsync(undefined)) } }) });
    await runDeleteEvent(ctx, { eventId: 'ev1', calendar: 'c1' }, []);
    expect(refs).toEqual([{ calendarId: 'c1', eventId: 'ev1', sendUpdates: 'none' }]);
    expect(ctx.output.stdout).toEqual(['Deleted event ev1 from calendar c1.']);
  });

  it('prints a JSON confirmation with --json', async () => {
    const ctx = fakeContext({ services: fakeServices({ calendar: { deleteEvent: () => okAsync(undefined) } }) });
    await runDeleteEvent(ctx, { eventId: 'ev1', json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual({ kind: 'deleted', calendarId: 'primary', eventId: 'ev1' });
  });

  it('rejects extra arguments', async () => {
    const ctx = fakeContext();
    await runDeleteEvent(ctx, { eventId: 'ev1' }, ['ev2']);
    expect(ctx.output.stderr.join('\n')).toContain('"ev2"');
  });
});
