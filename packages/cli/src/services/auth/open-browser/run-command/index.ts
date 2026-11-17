import { spawn } from 'node:child_process';

import { ResultAsync, err, ok } from 'neverthrow';

// Runs one external command (a browser opener) detached from our stdio.

export type OpenCommand = { readonly command: string; readonly args: readonly string[] };

// How a command failed: it ran and exited non-zero (no code: killed by a signal), or it could not be spawned.
export type OpenCommandStatus = { readonly kind: 'exited'; readonly code: number | null } | { readonly kind: 'spawn-failed'; readonly cause: unknown };

const describeStatus = (status: OpenCommandStatus): string => {
  switch (status.kind) {
    case 'exited':
      return status.code === null ? 'was terminated by a signal' : `exited with code ${status.code}`;
    case 'spawn-failed':
      return 'could not be started';
    default: {
      const _exhaustive: never = status;
      throw new Error(`unhandled open command status: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// One opener command failed. A spawn error (e.g. ENOENT) is kept on `cause`.
export class OpenCommandError extends Error {
  override name = 'OpenCommandError' as const;
  readonly command: string;
  readonly status: OpenCommandStatus;

  constructor(command: string, status: OpenCommandStatus) {
    super(`${command} ${describeStatus(status)}`, status.kind === 'spawn-failed' ? { cause: status.cause } : undefined);
    this.command = command;
    this.status = status;
  }
}

export type RunCommand = (cmd: OpenCommand) => ResultAsync<void, OpenCommandError>;

// Exit 0 succeeds; a missing binary or a non-zero exit fails. Never rejects.
export const runCommand: RunCommand = (cmd) =>
  new ResultAsync(
    new Promise((resolve) => {
      const child = spawn(cmd.command, [...cmd.args], { stdio: 'ignore' });
      child.once('error', (cause) => resolve(err(new OpenCommandError(cmd.command, { kind: 'spawn-failed', cause }))));
      child.once('exit', (code) => resolve(code === 0 ? ok(undefined) : err(new OpenCommandError(cmd.command, { kind: 'exited', code }))));
      child.unref();
    }),
  );
