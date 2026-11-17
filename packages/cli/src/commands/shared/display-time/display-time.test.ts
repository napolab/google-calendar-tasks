import { describe, expect, it } from 'vitest';

import { formatClock, formatDay, formatInstant, formatInstantRange } from './index';

describe('formatInstant', () => {
  it('shows an instant in Asia/Tokyo', () => {
    expect(formatInstant('2026-11-17T01:00:00Z')).toBe('2026-11-17 10:00');
  });

  it('converts other offsets to Asia/Tokyo', () => {
    expect(formatInstant('2026-11-16T23:30:00-08:00')).toBe('2026-11-17 16:30');
  });
});

describe('formatDay / formatClock', () => {
  it('split an instant into its Asia/Tokyo day and time', () => {
    expect(formatDay('2026-11-17T15:30:00Z')).toBe('2026-11-18');
    expect(formatClock('2026-11-17T15:30:00Z')).toBe('00:30');
  });
});

describe('formatInstantRange', () => {
  it('shows a same-day range once with both clock times', () => {
    expect(formatInstantRange('2026-11-17T01:00:00Z', '2026-11-17T02:30:00Z')).toBe('2026-11-17 10:00–11:30');
  });

  it('shows both days when the range crosses midnight in Asia/Tokyo', () => {
    expect(formatInstantRange('2026-11-17T14:00:00Z', '2026-11-17T16:00:00Z')).toBe('2026-11-17 23:00 – 2026-11-18 01:00');
  });
});
