import { errAsync } from 'neverthrow';

import { tryCommand } from '../opener';

import type { BrowserOpener, OpenerDeps } from '../opener';

// macOS: `open`.
export const createMacOpenOpener = (deps: OpenerDeps): BrowserOpener => ({
  name: 'open',
  run: (request) => (deps.environment.platform === 'darwin' ? tryCommand('open', deps, { command: 'open', args: [request.url] }, request) : errAsync(request)),
});
