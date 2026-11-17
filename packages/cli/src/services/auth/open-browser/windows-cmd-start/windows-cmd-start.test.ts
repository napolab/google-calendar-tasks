import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { OpenCommandError } from '../run-command';

import { createWindowsCmdStartOpener } from './index';

import type { Environment } from '../environment';
import type { OpenCommand, RunCommand } from '../run-command';

const URL_WITH_AMPS = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=a&scope=b%20c&state=d';
const REQUEST = { url: URL_WITH_AMPS, failures: [] };

const fakeRun = (succeeds: boolean) => {
  const calls: OpenCommand[] = [];
  const run: RunCommand = (cmd) => {
    calls.push(cmd);
    return succeeds ? okAsync(undefined) : errAsync(new OpenCommandError(cmd.command, { kind: 'exited', code: 1 }));
  };
  return { run, calls };
};

const APPLIES: Environment = { platform: 'linux', wsl: true };
const DOES_NOT_APPLY: Environment = { platform: 'darwin', wsl: false };

describe('createWindowsCmdStartOpener', () => {
  it('runs cmd.exe with the URL where it applies', async () => {
    const fake = fakeRun(true);

    const result = await createWindowsCmdStartOpener({ environment: APPLIES, run: fake.run }).run(REQUEST);

    expect(result._unsafeUnwrap()).toEqual({ opener: 'cmd.exe start' });
    expect(fake.calls).toEqual([{ command: 'cmd.exe', args: ['/c', 'start', '', 'https://accounts.google.com/o/oauth2/v2/auth?client_id=a^\&scope=b%20c^\&state=d'] }]);
  });

  it('passes the request on untouched, running nothing, where it does not apply', async () => {
    const fake = fakeRun(true);

    const result = await createWindowsCmdStartOpener({ environment: DOES_NOT_APPLY, run: fake.run }).run(REQUEST);

    expect(result._unsafeUnwrapErr()).toEqual(REQUEST);
    expect(fake.calls).toEqual([]);
  });

  it('passes the request on with the command failure recorded when the command fails', async () => {
    const result = await createWindowsCmdStartOpener({ environment: APPLIES, run: fakeRun(false).run }).run(REQUEST);

    const next = result._unsafeUnwrapErr();
    expect(next.url).toBe(URL_WITH_AMPS);
    expect(next.failures.map((failure) => failure.command)).toEqual(['cmd.exe']);
  });
});

describe('createWindowsCmdStartOpener on native Windows', () => {
  it('applies on win32 too', async () => {
    const fake = fakeRun(true);

    await createWindowsCmdStartOpener({ environment: { platform: 'win32', wsl: false }, run: fake.run }).run(REQUEST);

    expect(fake.calls.map((cmd) => cmd.command)).toEqual(['cmd.exe']);
  });
});
