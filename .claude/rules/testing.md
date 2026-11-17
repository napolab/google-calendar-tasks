---
paths:
  - "**/*.test.ts"
  - "**/*.test-d.ts"
---

# Testing Conventions

## Vitest for Testing

Use Vitest for all tests in this project (`vitest run --typecheck`; type-level tests go in `*.test-d.ts`).

```ts
import { describe, expect, it } from 'vitest';

describe('toEventTime', () => {
  it('formats an all-day date without a time part', () => {
    expect(toEventTime({ date: '2026-11-17' })).toEqual({ date: '2026-11-17' });
  });
});
```

## Faking Google

Core services receive `fetch` and a token provider through their factory. Tests pass a fake `fetch` that asserts the request (method, URL, query, body, `Authorization` header) and returns a canned `Response`. Assert on the `Result` (`isOk()` / `isErr()` + `instanceof` of the error class), not on thrown exceptions.

## Test Organization

Colocate tests with the code they test:

```
packages/core/src/calendar/
├── index.ts
└── calendar.test.ts
```

## Test File Naming

- Unit tests: `<module-name>.test.ts`
- Type tests: `<module-name>.test-d.ts`
- Integration tests (real Google API, opt-in, never in CI): `<feature-name>.integration.test.ts`
