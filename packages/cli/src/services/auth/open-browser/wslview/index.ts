import { errAsync } from 'neverthrow';

import { tryCommand } from '../opener';

import type { BrowserOpener, OpenerDeps } from '../opener';

// WSL: `wslview` (wslu) opens the URL in the Windows default browser.
export const createWslviewOpener = (deps: OpenerDeps): BrowserOpener => ({
  name: 'wslview',
  run: (request) => (deps.environment.wsl ? tryCommand('wslview', deps, { command: 'wslview', args: [request.url] }, request) : errAsync(request)),
});
