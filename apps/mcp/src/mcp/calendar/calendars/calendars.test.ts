import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { depsWith, errorTextOf, jsonOf, recorder } from '../test-support';
import { createCalendarsToolHandlers } from './index';

import type { Calendar, CreateCalendarInput, DeleteCalendarInput, ICalendarService, UpdateCalendarInput } from '@napolab/gct-core/calendar';

const calendar: Calendar = { id: 'c1', summary: 'Team', description: '', location: 'Tokyo', timeZone: { kind: 'iana', name: 'Asia/Tokyo' }, dataOwner: { kind: 'email', email: 'me@example.com' } };

const view = { id: 'c1', summary: 'Team', description: null, location: 'Tokyo', timeZone: 'Asia/Tokyo', dataOwner: 'me@example.com' };

const handlersWith = (overrides: Partial<ICalendarService>) => createCalendarsToolHandlers(depsWith(overrides));

describe('calendar tools', () => {
  it('get_calendar returns the normalized metadata, defaulting to primary', async () => {
    const get = recorder((_input: { readonly calendarId?: string }) => okAsync(calendar));
    const handlers = handlersWith({ getCalendar: get.fn });

    expect(jsonOf(await handlers.getCalendar({}))).toEqual(view);
    expect(get.calls).toEqual([{}]);
  });

  it('create_calendar maps the optional details', async () => {
    const create = recorder((_input: CreateCalendarInput) => okAsync(calendar));
    const handlers = handlersWith({ createCalendar: create.fn });

    expect(jsonOf(await handlers.createCalendar({ summary: 'Team', timeZone: 'Asia/Tokyo' }))).toEqual(view);
    expect(create.calls).toEqual([{ summary: 'Team', description: '', location: '', timeZone: { kind: 'iana', name: 'Asia/Tokyo' } }]);
  });

  it('create_calendar rejects an unknown time zone', async () => {
    const handlers = handlersWith({});

    expect(errorTextOf(await handlers.createCalendar({ summary: 'Team', timeZone: 'Tokyo' }))).toContain('"Tokyo"');
  });

  it('update_calendar maps set / clear / keep', async () => {
    const update = recorder((_input: UpdateCalendarInput) => okAsync(calendar));
    const handlers = handlersWith({ updateCalendar: update.fn });

    await handlers.updateCalendar({ calendarId: 'c1', summary: 'New', clearDescription: true, timeZone: 'UTC' });

    expect(update.calls).toEqual([{ calendarId: 'c1', summary: { kind: 'set', value: 'New' }, description: { kind: 'clear' }, location: { kind: 'keep' }, timeZone: { kind: 'set', value: 'UTC' } }]);
  });

  it('update_calendar rejects a call that changes nothing', async () => {
    const handlers = handlersWith({});

    expect(errorTextOf(await handlers.updateCalendar({ calendarId: 'c1' }))).toContain('Nothing to update');
  });

  it('delete_calendar confirms what was deleted', async () => {
    const remove = recorder((_input: DeleteCalendarInput) => okAsync(undefined));
    const handlers = handlersWith({ deleteCalendar: remove.fn });

    expect(jsonOf(await handlers.deleteCalendar({ calendarId: 'c1' }))).toEqual({ deleted: true, calendarId: 'c1' });
    expect(remove.calls).toEqual([{ calendarId: 'c1' }]);
  });

  it('clear_calendar clears the primary calendar', async () => {
    const clear = recorder((_input: undefined) => okAsync(undefined));
    const handlers = handlersWith({ clearPrimaryCalendar: () => clear.fn(undefined) });

    expect(jsonOf(await handlers.clearCalendar({ confirm: 'delete-all-events' }))).toEqual({ cleared: true, calendarId: 'primary' });
    expect(clear.calls).toHaveLength(1);
  });
});
