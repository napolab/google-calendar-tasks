import { errAsync } from 'neverthrow';

import { tryCommand } from '../opener';

import type { BrowserOpener, OpenerDeps } from '../opener';

// Linux desktops (and WSL with a Linux browser): `xdg-open`.
export const createXdgOpenOpener = (deps: OpenerDeps): BrowserOpener => ({
  name: 'xdg-open',
  run: (request) => (deps.environment.platform === 'linux' ? tryCommand('xdg-open', deps, { command: 'xdg-open', args: [request.url] }, request) : errAsync(request)),
});
