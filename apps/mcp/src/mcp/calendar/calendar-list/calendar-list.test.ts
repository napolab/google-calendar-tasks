import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { depsWith, errorTextOf, jsonOf, recorder } from '../test-support';
import { createCalendarListToolHandlers } from './index';

import type { CalendarListEntry, ICalendarService, SubscribeCalendarInput, UnsubscribeCalendarInput, UpdateCalendarListEntryInput } from '@napolab/gct-core/calendar';

const entry: CalendarListEntry = {
  id: 'c1',
  summary: 'Team',
  summaryOverride: '',
  description: '',
  location: '',
  timeZone: { kind: 'iana', name: 'Asia/Tokyo' },
  accessRole: 'reader',
  primary: false,
  hidden: false,
  selected: true,
  colorId: '7',
  backgroundColor: { kind: 'hex', hex: '#42d692' },
  foregroundColor: { kind: 'none' },
  defaultReminders: [],
  notifications: ['eventCreation'],
};

const handlersWith = (overrides: Partial<ICalendarService>) => createCalendarListToolHandlers(depsWith(overrides));

describe('calendar list tools', () => {
  it('get_calendar_list_entry shows the display settings with null for absent values', async () => {
    const handlers = handlersWith({ getCalendarListEntry: () => okAsync(entry) });

    expect(jsonOf(await handlers.getCalendarListEntry({ calendarId: 'c1' }))).toEqual({
      id: 'c1',
      summary: 'Team',
      summaryOverride: null,
      description: null,
      location: null,
      timeZone: 'Asia/Tokyo',
      accessRole: 'reader',
      primary: false,
      hidden: false,
      selected: true,
      colorId: '7',
      backgroundColor: '#42d692',
      foregroundColor: null,
      defaultReminders: [],
      notifications: ['eventCreation'],
    });
  });

  it.each([
    [{ calendarId: 'c1' }, { calendarId: 'c1', color: { kind: 'default' } }],
    [
      { calendarId: 'c1', colorId: '3' },
      { calendarId: 'c1', color: { kind: 'palette', colorId: '3' } },
    ],
    [
      { calendarId: 'c1', backgroundColor: '#0088aa', foregroundColor: '#ffffff' },
      { calendarId: 'c1', color: { kind: 'rgb', background: '#0088aa', foreground: '#ffffff' } },
    ],
  ])('subscribe_calendar maps %o', async (args, expected) => {
    const subscribe = recorder((_input: SubscribeCalendarInput) => okAsync(entry));
    const handlers = handlersWith({ subscribeCalendar: subscribe.fn });

    await handlers.subscribeCalendar(args);

    expect(subscribe.calls).toEqual([expected]);
  });

  it.each([
    [{ calendarId: 'c1', colorId: '3', backgroundColor: '#000000', foregroundColor: '#ffffff' }, 'colorId'],
    [{ calendarId: 'c1', backgroundColor: '#000000' }, 'foregroundColor'],
  ])('subscribe_calendar rejects an ambiguous color (%#)', async (args, expected) => {
    const handlers = handlersWith({});

    expect(errorTextOf(await handlers.subscribeCalendar(args))).toContain(expected);
  });

  it('update_calendar_list_entry maps every patch', async () => {
    const update = recorder((_input: UpdateCalendarListEntryInput) => okAsync(entry));
    const handlers = handlersWith({ updateCalendarListEntry: update.fn });

    await handlers.updateCalendarListEntry({
      calendarId: 'c1',
      clearSummaryOverride: true,
      colorId: '2',
      hidden: true,
      selected: false,
      defaultReminders: [{ method: 'popup', minutes: 15 }],
      notifications: [],
    });

    expect(update.calls).toEqual([
      {
        calendarId: 'c1',
        summaryOverride: { kind: 'clear' },
        color: { kind: 'set', value: { kind: 'palette', colorId: '2' } },
        hidden: { kind: 'set', value: true },
        selected: { kind: 'set', value: false },
        defaultReminders: { kind: 'set', value: [{ method: 'popup', minutes: 15 }] },
        notifications: { kind: 'set', value: [] },
      },
    ]);
  });

  it('update_calendar_list_entry rejects a call that changes nothing', async () => {
    const handlers = handlersWith({});

    expect(errorTextOf(await handlers.updateCalendarListEntry({ calendarId: 'c1' }))).toContain('Nothing to update');
  });

  it('unsubscribe_calendar confirms what was removed', async () => {
    const remove = recorder((_input: UnsubscribeCalendarInput) => okAsync(undefined));
    const handlers = handlersWith({ unsubscribeCalendar: remove.fn });

    expect(jsonOf(await handlers.unsubscribeCalendar({ calendarId: 'c1' }))).toEqual({ unsubscribed: true, calendarId: 'c1' });
  });
});
