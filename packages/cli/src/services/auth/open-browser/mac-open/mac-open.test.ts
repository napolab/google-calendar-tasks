import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { OpenCommandError } from '../run-command';

import { createMacOpenOpener } from './index';

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

const APPLIES: Environment = { platform: 'darwin', wsl: false };
const DOES_NOT_APPLY: Environment = { platform: 'linux', wsl: false };

describe('createMacOpenOpener', () => {
  it('runs open with the URL where it applies', async () => {
    const fake = fakeRun(true);

    const result = await createMacOpenOpener({ environment: APPLIES, run: fake.run }).run(REQUEST);

    expect(result._unsafeUnwrap()).toEqual({ opener: 'open' });
    expect(fake.calls).toEqual([{ command: 'open', args: [URL_WITH_AMPS] }]);
  });

  it('passes the request on untouched, running nothing, where it does not apply', async () => {
    const fake = fakeRun(true);

    const result = await createMacOpenOpener({ environment: DOES_NOT_APPLY, run: fake.run }).run(REQUEST);

    expect(result._unsafeUnwrapErr()).toEqual(REQUEST);
    expect(fake.calls).toEqual([]);
  });

  it('passes the request on with the command failure recorded when the command fails', async () => {
    const result = await createMacOpenOpener({ environment: APPLIES, run: fakeRun(false).run }).run(REQUEST);

    const next = result._unsafeUnwrapErr();
    expect(next.url).toBe(URL_WITH_AMPS);
    expect(next.failures.map((failure) => failure.command)).toEqual(['open']);
  });
});
