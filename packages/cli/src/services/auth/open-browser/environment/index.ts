import { readFileSync } from 'node:fs';

import { Result } from 'neverthrow';

// Where the CLI runs, as far as opening a browser is concerned.
export type Environment = { readonly platform: NodeJS.Platform; readonly wsl: boolean };

export type EnvironmentProbe = {
  readonly platform: NodeJS.Platform;
  readonly env: { readonly WSL_DISTRO_NAME?: string | undefined };
  // Contents of /proc/version ('' when unreadable); WSL kernels mention "microsoft".
  readonly procVersion: string;
};

export const detectEnvironment = (probe: EnvironmentProbe): Environment => ({
  platform: probe.platform,
  wsl: probe.platform === 'linux' && ((probe.env.WSL_DISTRO_NAME ?? '') !== '' || /microsoft/i.test(probe.procVersion)),
});

// '' when unreadable (not Linux, or /proc not mounted).
const readProcVersion = (): string =>
  Result.fromThrowable(
    () => readFileSync('/proc/version', 'utf8'),
    () => undefined,
  )().unwrapOr('');

// The current process's environment (reads process.platform, process.env and /proc/version).
export const readEnvironment = (): Environment => detectEnvironment({ platform: process.platform, env: process.env, procVersion: readProcVersion() });
