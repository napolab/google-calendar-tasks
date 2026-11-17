import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { nextDate, parseDate, parseDateTime, parseWindowBound, toWindowEnd, toWindowStart } from './index';

describe('parseDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(parseDate('--due', '2026-11-20')._unsafeUnwrap()).toBe('2026-11-20');
  });

  it('rejects an impossible date, naming the flag and the format', () => {
    const error = parseDate('--due', '2026-02-30')._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--due "2026-02-30"');
    expect(error.message).toContain('YYYY-MM-DD');
  });

  it('rejects a date-time', () => {
    expect(parseDate('--date', '2026-11-20T10:00:00+09:00').isErr()).toBe(true);
  });
});

describe('parseDateTime', () => {
  it('accepts RFC 3339 with an offset', () => {
    expect(parseDateTime('--start', '2026-11-17T10:00:00+09:00')._unsafeUnwrap()).toBe('2026-11-17T10:00:00+09:00');
  });

  it('accepts RFC 3339 in UTC (Z)', () => {
    expect(parseDateTime('--start', '2026-11-17T01:00:00Z')._unsafeUnwrap()).toBe('2026-11-17T01:00:00Z');
  });

  it('rejects a date-time without an offset and explains how to add one', () => {
    const error = parseDateTime('--start', '2026-11-17T10:00')._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--start "2026-11-17T10:00"');
    expect(error.message).toContain('offset');
    expect(error.message).toContain('+09:00');
  });
});

describe('parseWindowBound', () => {
  it('reads YYYY-MM-DD as a date', () => {
    expect(parseWindowBound('--from', '2026-11-17')._unsafeUnwrap()).toEqual({ kind: 'date', date: '2026-11-17' });
  });

  it('reads RFC 3339 with offset as an instant', () => {
    expect(parseWindowBound('--from', '2026-11-17T10:00:00+09:00')._unsafeUnwrap()).toEqual({ kind: 'dateTime', dateTime: '2026-11-17T10:00:00+09:00' });
  });

  it('rejects anything else, listing both accepted formats', () => {
    const error = parseWindowBound('--to', 'tomorrow')._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--to "tomorrow"');
    expect(error.message).toContain('YYYY-MM-DD');
    expect(error.message).toContain('RFC 3339');
  });
});

describe('toWindowStart / toWindowEnd', () => {
  it('starts a date at midnight Asia/Tokyo', () => {
    expect(toWindowStart({ kind: 'date', date: '2026-11-17' })).toBe('2026-11-17T00:00:00+09:00');
  });

  it('ends a date at the following midnight Asia/Tokyo (the day is inclusive)', () => {
    expect(toWindowEnd({ kind: 'date', date: '2026-11-17' })).toBe('2026-11-18T00:00:00+09:00');
  });

  it('passes an instant through unchanged', () => {
    expect(toWindowStart({ kind: 'dateTime', dateTime: '2026-11-17T01:00:00Z' })).toBe('2026-11-17T01:00:00Z');
    expect(toWindowEnd({ kind: 'dateTime', dateTime: '2026-11-17T01:00:00Z' })).toBe('2026-11-17T01:00:00Z');
  });
});

describe('nextDate', () => {
  it('returns the following calendar day, across month ends', () => {
    expect(nextDate('2026-11-30')).toBe('2026-12-01');
  });
});
