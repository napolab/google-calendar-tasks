import { errAsync } from 'neverthrow';

import { tryCommand } from '../opener';

import type { Environment } from '../environment';
import type { BrowserOpener, OpenerDeps } from '../opener';
import type { OpenCommand } from '../run-command';

// Windows' `start` through cmd.exe — natively, or from WSL through interop.

// cmd.exe treats & | < > ^ as operators even inside an argument; caret-escape them.
// (WSL interop passes args without spaces unquoted, so an unescaped & would cut the URL at the first parameter.)
const escapeForCmd = (value: string): string => value.replace(/[\^&|<>]/g, (char) => `^${char}`);

// `start` takes the first quoted argument as the window title, hence the empty title argument.
const startCommand = (url: string): OpenCommand => ({ command: 'cmd.exe', args: ['/c', 'start', '', escapeForCmd(url)] });

const applies = (environment: Environment): boolean => environment.wsl || environment.platform === 'win32';

export const createWindowsCmdStartOpener = (deps: OpenerDeps): BrowserOpener => ({
  name: 'cmd.exe start',
  run: (request) => (applies(deps.environment) ? tryCommand('cmd.exe start', deps, startCommand(request.url), request) : errAsync(request)),
});
