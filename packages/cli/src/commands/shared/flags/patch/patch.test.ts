import { InvalidInputError } from '@napolab/gct-core/errors';
import { describe, expect, it } from 'vitest';

import { toKeepOrSet, toListPatch, toTextPatch } from './index';

describe('toTextPatch', () => {
  it('keeps the field when neither flag is given', () => {
    expect(toTextPatch('description', undefined, undefined)._unsafeUnwrap()).toEqual({ kind: 'keep' });
  });

  it('sets the field from --<name>', () => {
    expect(toTextPatch('description', 'agenda', undefined)._unsafeUnwrap()).toEqual({ kind: 'set', value: 'agenda' });
  });

  it('clears the field from --clear-<name>', () => {
    expect(toTextPatch('description', undefined, true)._unsafeUnwrap()).toEqual({ kind: 'clear' });
  });

  it('rejects giving both flags', () => {
    const error = toTextPatch('description', 'agenda', true)._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--description');
    expect(error.message).toContain('--clear-description');
  });

  it('rejects an empty value and points at --clear-<name>', () => {
    const error = toTextPatch('location', '', undefined)._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toContain('--clear-location');
  });
});

describe('toListPatch', () => {
  it('sets the list from repeated flags', () => {
    expect(toListPatch({ set: 'attendee', clear: 'attendees' }, ['a@example.com', 'b@example.com'], undefined)._unsafeUnwrap()).toEqual({ kind: 'set', value: ['a@example.com', 'b@example.com'] });
  });

  it('clears the list', () => {
    expect(toListPatch({ set: 'attendee', clear: 'attendees' }, undefined, true)._unsafeUnwrap()).toEqual({ kind: 'clear' });
  });

  it('rejects both', () => {
    const error = toListPatch({ set: 'attendee', clear: 'attendees' }, ['a@example.com'], true)._unsafeUnwrapErr();
    expect(error.message).toContain('--attendee');
    expect(error.message).toContain('--clear-attendees');
  });
});

describe('toKeepOrSet', () => {
  it('keeps when absent and sets when given', () => {
    expect(toKeepOrSet('title', undefined)._unsafeUnwrap()).toEqual({ kind: 'keep' });
    expect(toKeepOrSet('title', 'Buy milk')._unsafeUnwrap()).toEqual({ kind: 'set', value: 'Buy milk' });
  });

  it('rejects an empty value', () => {
    expect(toKeepOrSet('title', '')._unsafeUnwrapErr().message).toContain('--title');
  });
});
