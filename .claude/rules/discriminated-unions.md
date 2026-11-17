---
description: Model data as fine-grained discriminated unions; minimize optional fields
paths:
  - "packages/*/src/**/*.ts"
  - "apps/*/src/**/*.ts"
---

# Discriminated Unions Over Optional Fields

Model every state as its own variant. An optional field (`x?: T`) is a hidden two-state union with no name — make the states explicit instead. Consume the unions with `switch` (`branching-modeled-state-with-switch` skill); see `precise-type-modeling` skill.

## Do

```ts
// Field that only exists in one state → it is required inside that variant
type Task =
  | { status: 'needsAction'; id: string; title: string; due: Due }
  | { status: 'completed'; id: string; title: string; due: Due; completedAt: string };

// "May be absent" → name the absent case
type Due = { kind: 'none' } | { kind: 'date'; date: string };

// Patch inputs → per-field tri-state, not a bag of optionals
type FieldPatch<T> = { kind: 'keep' } | { kind: 'set'; value: T } | { kind: 'clear' };
```

## Don't

```ts
type Task = { id: string; status: string; completed?: string; due?: string; parent?: string };
type UpdateTask = { title?: string; due?: string | null };
```

## Allowed optionals

- Wire-format schemas that describe what Google actually returns (zod schemas at the boundary). Convert them to the domain unions immediately.
- A single defaulted argument at the outermost input edge (e.g. `calendarId` defaulting to `primary`) when a variant would only add noise — justify it in a comment.
