import { GoogleAuthError, GoogleNotFoundError, InvalidInputError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { NotLoggedInError } from '../../../context/errors';
import { createFakeOutput } from '../../../test-support';

import { formatError, formatUsageFailure, prefixed, renderWith, report, reportMissingSubcommand } from './index';

describe('formatError', () => {
  it('prints the class name and message', () => {
    expect(formatError(new GoogleNotFoundError('Google API 404: Not Found'))).toBe('GoogleNotFoundError: Google API 404: Not Found');
  });

  it('tells a logged-out user to run gct login', () => {
    expect(formatError(new NotLoggedInError('Not logged in to Google yet.'))).toContain('gct login');
  });

  it('tells the user to log in again when Google rejects the credentials', () => {
    expect(formatError(new GoogleAuthError('Google API 401: invalid_grant'))).toContain('gct login');
  });
});

describe('formatUsageFailure', () => {
  it('lists every gunshi validation error', () => {
    const text = formatUsageFailure(new AggregateError([new Error("Optional argument '--max' should be 'number'"), new Error('Command not found: nope')]));
    expect(text).toContain("Optional argument '--max' should be 'number'");
    expect(text).toContain('Command not found: nope');
    expect(text).toContain('--help');
  });

  it('prints other errors with their name', () => {
    expect(formatUsageFailure(new TypeError('boom'))).toBe('TypeError: boom');
  });
});

describe('renderWith', () => {
  const text = (value: { readonly n: number }) => `n=${value.n}`;

  it('uses the text renderer by default', () => {
    expect(renderWith(undefined, text)({ n: 1 })).toBe('n=1');
  });

  it('prints JSON with --json', () => {
    expect(JSON.parse(renderWith(true, text)({ n: 1 }))).toEqual({ n: 1 });
  });
});

describe('report', () => {
  it('prints a success to stdout', async () => {
    const io = createFakeOutput();
    await report(io, okAsync(2), (n) => `got ${n}`);
    expect(io.stdout).toEqual(['got 2']);
    expect(io.failed()).toBe(false);
  });

  it('prints a failure to stderr and fails the process', async () => {
    const io = createFakeOutput();
    await report(io, errAsync(new InvalidInputError('bad --from')), () => 'unused');
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toEqual(['InvalidInputError: bad --from']);
    expect(io.failed()).toBe(true);
  });
});

describe('reportMissingSubcommand', () => {
  it('lists the sub-commands on stderr and fails', () => {
    const io = createFakeOutput();
    reportMissingSubcommand(io, 'gct events', ['list', 'get']);
    expect(io.stderr.join('\n')).toContain('gct events <list|get>');
    expect(io.stderr.join('\n')).toContain('gct events --help');
    expect(io.failed()).toBe(true);
  });
});

describe('prefixed', () => {
  it('puts a label before the rendered value', () => {
    expect(prefixed('Created: ', (n: number) => `#${n}`)(3)).toBe('Created: #3');
  });
});
