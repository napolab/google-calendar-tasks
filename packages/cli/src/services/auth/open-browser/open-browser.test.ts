import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { OpenCommandError } from './run-command';

import { BrowserOpenError, createOpenBrowser } from './index';

import type { Environment } from './environment';
import type { OpenCommand, RunCommand } from './run-command';

const URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=a';
const WSL: Environment = { platform: 'linux', wsl: true };

// Succeeds only for the listed commands and records every attempt.
const fakeRun = (working: readonly string[]) => {
  const calls: string[] = [];
  const run: RunCommand = (cmd: OpenCommand) => {
    calls.push(cmd.command);
    return working.includes(cmd.command) ? okAsync(undefined) : errAsync(new OpenCommandError(cmd.command, { kind: 'exited', code: 1 }));
  };
  return { run, calls };
};

describe('createOpenBrowser', () => {
  it('on WSL tries wslview first and stops at the first opener that works', async () => {
    const fake = fakeRun(['cmd.exe']);

    const result = await createOpenBrowser({ environment: WSL, run: fake.run })(URL);

    expect(result._unsafeUnwrap()).toEqual({ opener: 'cmd.exe start' });
    expect(fake.calls).toEqual(['wslview', 'cmd.exe']);
  });

  it('fails with every command failure, in the order tried, when no opener works', async () => {
    const result = await createOpenBrowser({ environment: WSL, run: fakeRun([]).run })(URL);

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(BrowserOpenError);
    expect(error.failures.map((failure) => failure.command)).toEqual(['wslview', 'cmd.exe', 'xdg-open']);
  });

  it('uses only the openers that apply to the platform', async () => {
    const fake = fakeRun(['open']);

    const result = await createOpenBrowser({ environment: { platform: 'darwin', wsl: false }, run: fake.run })(URL);

    expect(result._unsafeUnwrap()).toEqual({ opener: 'open' });
    expect(fake.calls).toEqual(['open']);
  });

  it('fails without running anything on a platform no opener supports', async () => {
    const fake = fakeRun([]);

    const result = await createOpenBrowser({ environment: { platform: 'aix', wsl: false }, run: fake.run })(URL);

    expect(result._unsafeUnwrapErr().failures).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});
