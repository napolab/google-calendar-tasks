import type { Environment } from '../environment';
import type { AsyncPlugin } from '../runner';
import type { OpenCommand, OpenCommandError, RunCommand } from '../run-command';
import type { ResultAsync } from 'neverthrow';

// The browser-opener plugin contract. A plugin that does not apply to the environment returns `err(input)`;
// one whose command fails returns the request with that failure recorded, so the final error can list them all.

export type OpenRequest = { readonly url: string; readonly failures: readonly OpenCommandError[] };

export type Opened = { readonly opener: string };

export type BrowserOpener = AsyncPlugin<OpenRequest, Opened> & { readonly name: string };

export type OpenerDeps = { readonly environment: Environment; readonly run: RunCommand };

// Runs the opener's command: success → opened by `name`; failure → the request, carrying the failure.
export const tryCommand = (name: string, deps: OpenerDeps, cmd: OpenCommand, request: OpenRequest): ResultAsync<Opened, OpenRequest> =>
  deps
    .run(cmd)
    .map((): Opened => ({ opener: name }))
    .mapErr((failure): OpenRequest => ({ ...request, failures: [...request.failures, failure] }));
