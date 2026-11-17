import { createMacOpenOpener } from './mac-open';
import { createRunner } from './runner';
import { readEnvironment } from './environment';
import { runCommand } from './run-command';
import { createWindowsCmdStartOpener } from './windows-cmd-start';
import { createWslviewOpener } from './wslview';
import { createXdgOpenOpener } from './xdg-open';

import type { BrowserOpener, Opened, OpenerDeps, OpenRequest } from './opener';
import type { OpenCommandError } from './run-command';
import type { ResultAsync } from 'neverthrow';

// "Open this URL in the user's browser": the registry of opener plugins, tried first-match. Opening is
// best-effort — login prints the URL too and folds a failure into a hint.

// No opener worked; `failures` lists the commands that were tried, in order (empty: none applies here).
export class BrowserOpenError extends Error {
  override name = 'BrowserOpenError' as const;
  readonly failures: readonly OpenCommandError[];

  constructor(failures: readonly OpenCommandError[]) {
    super(failures.length === 0 ? 'No browser opener applies to this platform.' : `Could not open a browser: ${failures.map((failure) => failure.message).join('; ')}`);
    this.failures = failures;
  }
}

// Most specific first: on WSL wslview, then Windows' start via interop, then a Linux browser.
const openers = (deps: OpenerDeps): readonly BrowserOpener[] => [createWslviewOpener(deps), createWindowsCmdStartOpener(deps), createXdgOpenOpener(deps), createMacOpenOpener(deps)];

export const createOpenBrowser = (deps: OpenerDeps): ((url: string) => ResultAsync<Opened, BrowserOpenError>) => {
  const run = createRunner<OpenRequest, Opened>(openers(deps));
  return (url) => run({ url, failures: [] }).mapErr((request) => new BrowserOpenError(request.failures));
};

// Ready-made opener for the entrypoint: this machine's environment and real commands.
export const openInBrowser = (url: string): ResultAsync<Opened, BrowserOpenError> => createOpenBrowser({ environment: readEnvironment(), run: runCommand })(url);
