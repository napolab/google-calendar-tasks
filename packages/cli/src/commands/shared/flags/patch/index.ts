import { InvalidInputError } from '@napolab/gct-core/errors';
import { err, ok } from 'neverthrow';

import type { FieldPatch } from '@napolab/gct-core/calendar';
import type { KeepOrSet } from '@napolab/gct-core/tasks';
import type { Result } from 'neverthrow';

// Update flags → core patches: `--<name> v` sets, `--clear-<name>` clears, neither keeps.
// Giving both, or setting an empty value (which would duplicate `--clear-<name>`), is rejected.

// The flag names (without `--`) that set and clear one field.
export type PatchFlags = { readonly set: string; readonly clear: string };

// Which of the two flags were given.
type Given = 'neither' | 'set' | 'clear' | 'both';

const givenOf = (hasValue: boolean, clear: boolean | undefined): Given => {
  const given = { 'false-false': 'neither', 'true-false': 'set', 'false-true': 'clear', 'true-true': 'both' } satisfies Record<`${boolean}-${boolean}`, Given>;
  return given[`${hasValue}-${clear === true}`];
};

const bothError = (flags: PatchFlags): InvalidInputError => new InvalidInputError(`Pass either --${flags.set} (to change it) or --${flags.clear} (to remove it), not both.`);

const emptyError = (flags: PatchFlags): InvalidInputError => new InvalidInputError(`--${flags.set} is empty. Pass a non-empty value to change it, or --${flags.clear} to remove it.`);

const toFieldPatch = <T extends string | readonly string[]>(flags: PatchFlags, value: T | undefined, clear: boolean | undefined): Result<FieldPatch<T>, InvalidInputError> => {
  const given = givenOf(value !== undefined, clear);
  switch (given) {
    case 'neither':
      return ok({ kind: 'keep' });
    case 'clear':
      return ok({ kind: 'clear' });
    case 'both':
      return err(bothError(flags));
    case 'set':
      if (value === undefined || value.length === 0) return err(emptyError(flags));
      return ok({ kind: 'set', value });
    default: {
      const _exhaustive: never = given;
      throw new Error(`unhandled flags: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// `--<name>` / `--clear-<name>` for a text field.
export const toTextPatch = (name: string, value: string | undefined, clear: boolean | undefined): Result<FieldPatch<string>, InvalidInputError> =>
  toFieldPatch({ set: name, clear: `clear-${name}` }, value, clear);

// A repeatable flag (`--attendee a --attendee b`) and its clear flag (`--clear-attendees`).
export const toListPatch = (
  flags: { readonly set: string; readonly clear: string },
  values: readonly string[] | undefined,
  clear: boolean | undefined,
): Result<FieldPatch<readonly string[]>, InvalidInputError> => toFieldPatch({ set: flags.set, clear: `clear-${flags.clear}` }, values, clear);

// A field that can be replaced but never removed (e.g. a task title).
export const toKeepOrSet = (name: string, value: string | undefined): Result<KeepOrSet<string>, InvalidInputError> => {
  if (value === undefined) return ok({ kind: 'keep' });
  if (value === '') return err(new InvalidInputError(`--${name} is empty. Pass a non-empty value, or leave --${name} out to keep the current one.`));
  return ok({ kind: 'set', value });
};
