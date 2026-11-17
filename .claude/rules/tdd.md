---
description: Require TDD (Red-Green-Refactor) for every package's src
paths:
  - "packages/*/src/**/*.ts"
  - "apps/*/src/**/*.ts"
---

All code under `packages/*/src` and `apps/*/src` must be developed with TDD.

Invoke the `superpowers:test-driven-development` skill and follow the Red → Green → Refactor cycle.

- Place test files next to the implementation: `<module-name>.test.ts` (see `colocation.md`)
- Use vitest as the test runner: `pnpm --filter <pkg> exec vitest run <path>` to run a single file
- Follow the progression: fake it → triangulate → obvious implementation
- Google API calls are tested by injecting a fake `fetch` (core services take `fetch` as a dependency). Never hit the real Google API from a unit test.
