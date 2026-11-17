import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { inclusiveEndDate, nextDate, parseDate, parseDateTime, parseTimeZone, parseWindowBound, toWindowEnd, toWindowStart } from './index';

const messageOf = (result: { _unsafeUnwrapErr: () => Error }) => {
  const error = result._unsafeUnwrapErr();
  expect(error).toBeInstanceOf(InvalidInputError);
  return error.message;
};

describe('parseDate', () => {
  it('accepts an existing YYYY-MM-DD date', () => {
    expect(parseDate('due', '2026-11-17')._unsafeUnwrap()).toBe('2026-11-17');
  });

  it.each(['2026-02-30', '2026/11/17', '2026-11-17T10:00:00+09:00'])('rejects %s naming the argument, the value and the format', (value) => {
    const message = messageOf(parseDate('due', value));
    expect(message).toContain('due');
    expect(message).toContain(value);
    expect(message).toContain('YYYY-MM-DD');
  });
});

describe('parseDateTime', () => {
  it('accepts RFC 3339 with an offset', () => {
    expect(parseDateTime('time.start', '2026-11-17T10:00:00+09:00')._unsafeUnwrap()).toBe('2026-11-17T10:00:00+09:00');
    expect(parseDateTime('time.start', '2026-11-17T01:00:00Z')._unsafeUnwrap()).toBe('2026-11-17T01:00:00Z');
  });

  it('rejects a naive local time and tells to add the offset', () => {
    const message = messageOf(parseDateTime('time.start', '2026-11-17T10:00:00'));
    expect(message).toContain('time.start');
    expect(message).toContain('2026-11-17T10:00:00');
    expect(message).toContain('+09:00');
  });
});

describe('parseTimeZone', () => {
  it('accepts an IANA zone', () => {
    expect(parseTimeZone('time.timeZone', 'Asia/Tokyo')._unsafeUnwrap()).toBe('Asia/Tokyo');
  });

  it('rejects an unknown zone', () => {
    const message = messageOf(parseTimeZone('time.timeZone', 'JST+9'));
    expect(message).toContain('JST+9');
    expect(message).toContain('Asia/Tokyo');
  });
});

describe('window bounds', () => {
  it('reads a date as a whole day in Asia/Tokyo', () => {
    const bound = parseWindowBound('from', '2026-11-17')._unsafeUnwrap();
    expect(toWindowStart(bound)).toBe('2026-11-17T00:00:00+09:00');
    expect(toWindowEnd(bound)).toBe('2026-11-18T00:00:00+09:00');
  });

  it('keeps a date-time as is', () => {
    const bound = parseWindowBound('to', '2026-11-17T10:00:00Z')._unsafeUnwrap();
    expect(toWindowStart(bound)).toBe('2026-11-17T10:00:00Z');
    expect(toWindowEnd(bound)).toBe('2026-11-17T10:00:00Z');
  });

  it('rejects anything else naming both accepted formats', () => {
    const message = messageOf(parseWindowBound('from', 'tomorrow'));
    expect(message).toContain('tomorrow');
    expect(message).toContain('YYYY-MM-DD');
    expect(message).toContain('RFC 3339');
  });
});

describe('all-day date arithmetic', () => {
  it('moves between the inclusive last day and Google’s exclusive end', () => {
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
    expect(inclusiveEndDate('2027-01-01')).toBe('2026-12-31');
  });
});
