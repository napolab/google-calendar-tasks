import { InvalidInputError } from '@napolab/gct-core/errors';
import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeServices } from '../../test-support';

import { formatFreeBusy, runFreeBusy, toFreeBusyInput } from './index';

import type { FreeBusyInput, FreeBusyResult } from '@napolab/gct-core/calendar';

describe('toFreeBusyInput', () => {
  it('reads whole Asia/Tokyo days (inclusive --to) and defaults to the primary calendar', () => {
    expect(toFreeBusyInput({ from: '2026-11-17', to: '2026-11-18' })._unsafeUnwrap()).toEqual({
      timeMin: '2026-11-17T00:00:00+09:00',
      timeMax: '2026-11-19T00:00:00+09:00',
      calendarIds: ['primary'],
    });
  });

  it('passes RFC 3339 bounds and every --calendar through', () => {
    expect(toFreeBusyInput({ from: '2026-11-17T10:00:00+09:00', to: '2026-11-17T18:00:00+09:00', calendar: ['primary', 'team@example.com'] })._unsafeUnwrap()).toEqual({
      timeMin: '2026-11-17T10:00:00+09:00',
      timeMax: '2026-11-17T18:00:00+09:00',
      calendarIds: ['primary', 'team@example.com'],
    });
  });

  it('rejects a malformed bound', () => {
    const error = toFreeBusyInput({ from: 'today', to: '2026-11-18' })._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--from "today"');
  });
});

const RESULT: FreeBusyResult = {
  timeMin: '2026-11-17T00:00:00+09:00',
  timeMax: '2026-11-18T00:00:00+09:00',
  calendars: [
    { kind: 'ok', calendarId: 'primary', busy: [{ start: '2026-11-17T01:00:00Z', end: '2026-11-17T02:00:00Z' }] },
    { kind: 'ok', calendarId: 'team@example.com', busy: [] },
    { kind: 'error', calendarId: 'nope@example.com', reasons: ['notFound'] },
  ],
};

describe('formatFreeBusy', () => {
  it('shows each calendar with its busy intervals in Asia/Tokyo', () => {
    expect(formatFreeBusy(RESULT)).toBe(
      ['Free/busy 2026-11-17 00:00 – 2026-11-18 00:00 (Asia/Tokyo)', 'primary: busy', '  2026-11-17 10:00–11:00', 'team@example.com: free', 'nope@example.com: unavailable (notFound)'].join('\n'),
    );
  });
});

describe('runFreeBusy', () => {
  it('queries and prints', async () => {
    const calls: FreeBusyInput[] = [];
    const ctx = fakeContext({ services: fakeServices({ calendar: { queryFreeBusy: (input) => (calls.push(input), okAsync(RESULT)) } }) });
    await runFreeBusy(ctx, { from: '2026-11-17', to: '2026-11-17' }, []);
    expect(calls[0]?.timeMax).toBe('2026-11-18T00:00:00+09:00');
    expect(ctx.output.stdout).toEqual([formatFreeBusy(RESULT)]);
  });

  it('reports bad input before connecting', async () => {
    const ctx = fakeContext();
    await runFreeBusy(ctx, { from: '2026-11-17', to: 'tomorrow' }, []);
    expect(ctx.output.stderr.join('\n')).toContain('InvalidInputError: --to "tomorrow"');
  });
});
