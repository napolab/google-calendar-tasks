---
paths:
  - "packages/*/src/**/*"
  - "apps/*/src/**/*"
---

# File and Directory Naming Conventions

## Kebab-Case Everywhere

All files and directories use kebab-case:

```
packages/core/src/
├── google-client/       # NOT GoogleClient/ or googleClient/
├── calendar/
└── tasks/
```

## Namespace Convention

When a directory provides namespace context, child files should NOT repeat that namespace:

```
# Correct
calendar/
├── index.ts             # NOT calendar-service.ts
└── calendar.test.ts

# Incorrect
calendar/
├── calendar-service.ts  # Redundant - already in calendar/
└── calendar-schemas.ts  # Redundant - use schemas.ts
```

## Module Directory Structure

Each module lives in its own directory (see `colocation.md`):

```
<module-name>/
├── index.ts                  # Implementation & exports (a tsdown entry when it is public)
└── <module-name>.test.ts     # Tests (e.g., google-client.test.ts)
```

## Test File Naming

- Unit tests: `<module-name>.test.ts`
- Integration tests: `<feature-name>.integration.test.ts`

Always colocate tests with the code they test.
