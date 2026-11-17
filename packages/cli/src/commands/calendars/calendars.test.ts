import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeServices } from '../../test-support';

import { formatCalendar, formatCalendars, runCalendars } from './index';

import type { CalendarSummary } from '@napolab/gct-core/calendar';

const PRIMARY: CalendarSummary = { id: 'me@example.com', summary: 'Me', primary: true, accessRole: 'owner', timeZone: { kind: 'iana', name: 'Asia/Tokyo' }, backgroundColor: { kind: 'none' } };
const HOLIDAYS: CalendarSummary = {
  id: 'ja.japanese#holiday@group.v.calendar.google.com',
  summary: '',
  primary: false,
  accessRole: 'reader',
  timeZone: { kind: 'none' },
  backgroundColor: { kind: 'hex', hex: '#16a765' },
};

describe('formatCalendar', () => {
  it('marks the primary calendar and shows role and zone', () => {
    expect(formatCalendar(PRIMARY)).toBe('* Me  [me@example.com]  (owner, Asia/Tokyo)');
  });

  it('shows an untitled calendar without a zone', () => {
    expect(formatCalendar(HOLIDAYS)).toBe('  (no title)  [ja.japanese#holiday@group.v.calendar.google.com]  (reader)');
  });
});

describe('formatCalendars', () => {
  it('says when there are none', () => {
    expect(formatCalendars([])).toBe('No calendars.');
  });
});

describe('runCalendars', () => {
  it('lists calendars', async () => {
    const ctx = fakeContext({ services: fakeServices({ calendar: { listCalendars: () => okAsync([PRIMARY, HOLIDAYS]) } }) });
    await runCalendars(ctx, {}, []);
    expect(ctx.output.stdout).toEqual([formatCalendars([PRIMARY, HOLIDAYS])]);
  });

  it('prints JSON', async () => {
    const ctx = fakeContext({ services: fakeServices({ calendar: { listCalendars: () => okAsync([PRIMARY]) } }) });
    await runCalendars(ctx, { json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual([PRIMARY]);
  });

  it('fails when not logged in', async () => {
    const ctx = fakeContext();
    await runCalendars(ctx, {}, []);
    expect(ctx.output.failed()).toBe(true);
  });
});
