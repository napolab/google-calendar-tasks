import { describe, expect, it } from 'vitest';

import { ALL_SCOPES, GOOGLE_SCOPES } from './index';

describe('ALL_SCOPES', () => {
  it('lists every scope in GOOGLE_SCOPES exactly once', () => {
    expect([...ALL_SCOPES].sort()).toEqual(Object.values(GOOGLE_SCOPES).sort());
  });
});
