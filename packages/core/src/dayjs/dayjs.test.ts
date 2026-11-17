import { describe, expect, it } from 'vitest';

import { DEFAULT_TIME_ZONE, dayjs } from './index';

describe('dayjs (core instance)', () => {
  it('defaults to Asia/Tokyo', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Asia/Tokyo');
  });

  it('has the timezone plugin so a wall-clock time can be pinned to a zone', () => {
    expect(dayjs.tz('2026-11-17 09:00', DEFAULT_TIME_ZONE).format()).toBe('2026-11-17T09:00:00+09:00');
  });

  it('has the utc plugin', () => {
    expect(dayjs.utc('2026-11-17T00:00:00Z').toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });
});
