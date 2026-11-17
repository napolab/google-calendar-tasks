import { Server } from 'node:http';

import { serve } from '@hono/node-server';
import { ResultAsync, err, ok } from 'neverthrow';

import { CALLBACK_PATH, createCallbackApp } from '../callback-app';
import { LoginTimeoutError, LoopbackServerError } from '../../../context/errors';

import type { LoginCallback } from '../callback-app';
import type { Result } from 'neverthrow';

// Node shell around the Hono callback app: a single-shot listener on 127.0.0.1 for one login's OAuth redirect.
// The entrypoint owns it (start → pass to `login` → dispose); `login` only consumes the `LoopbackServer` view.

export type LoopbackServerOptions = {
  // The `state` sent in the authorization URL; callbacks carrying anything else are reported as invalid.
  readonly expectedState: string;
  // Deadline / cancellation owned by the entrypoint (e.g. `AbortSignal.timeout(...)`); aborting fails `callback`.
  readonly signal: AbortSignal;
};

export interface LoopbackServer {
  // `http://127.0.0.1:<port>/callback` — send this exact string as redirect_uri in both the auth URL and the code exchange.
  readonly redirectURI: string;
  // The login's redirect, awaited from the moment the server starts: the first request on the callback path, or
  // LoginTimeoutError when the signal aborts / the server is disposed first. Other paths are answered 404.
  readonly callback: ResultAsync<LoginCallback, LoginTimeoutError>;
}

export type OwnedLoopbackServer = LoopbackServer & AsyncDisposable;

const HOST = '127.0.0.1';
const CLOSE_GRACE_MS = 1_000;

type Listening = { readonly server: Server; readonly port: number };

// `serve` starts listening immediately; listen failures (e.g. EADDRINUSE) arrive as an 'error' event.
const listen = (fetch: (request: Request) => Response | Promise<Response>): Promise<Listening> =>
  new Promise((resolve, reject) => {
    const server = serve({ fetch, hostname: HOST, port: 0 }, (info) => {
      if (server instanceof Server) return resolve({ server, port: info.port });
      return reject(new Error('expected a node:http server'));
    });
    server.once('error', reject);
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    if (!server.listening) return resolve();
    // Drop idle keep-alive / preconnected sockets now; force the rest after a grace period so the process can exit.
    const force = setTimeout(() => server.closeAllConnections(), CLOSE_GRACE_MS);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      resolve();
    });
    server.closeIdleConnections();
    return undefined;
  });

type CallbackOutcome = Result<LoginCallback, LoginTimeoutError>;

// The login's single outcome: settled once by the first redirect, the signal or disposal — whichever comes first.
// It exists before the server listens, so a redirect can never arrive with nobody waiting.
const createOutcome = (signal: AbortSignal) => {
  const pending: { settle: (outcome: CallbackOutcome) => void } = { settle: () => undefined };
  const promise = new Promise<CallbackOutcome>((resolve) => {
    pending.settle = resolve;
  });
  const onAbort = () => settle(err(new LoginTimeoutError('The browser did not come back to the login callback in time. Run the login again.')));
  // Promise resolution is idempotent, so later redirects / aborts after the first outcome are ignored.
  const settle = (outcome: CallbackOutcome): void => {
    signal.removeEventListener('abort', onAbort);
    pending.settle(outcome);
  };
  if (signal.aborted) onAbort();
  signal.addEventListener('abort', onAbort, { once: true });
  return { callback: new ResultAsync(promise), settle };
};

export const startLoopbackServer = (options: LoopbackServerOptions): ResultAsync<OwnedLoopbackServer, LoopbackServerError> => {
  const outcome = createOutcome(options.signal);
  const app = createCallbackApp({ expectedState: options.expectedState, onCallback: (callback) => outcome.settle(ok(callback)) });
  const closedEarly = () => err(new LoginTimeoutError('The login callback server was closed before the browser came back.'));

  return ResultAsync.fromPromise(listen(app.fetch), (cause) => {
    outcome.settle(closedEarly());
    return new LoopbackServerError(`Could not start the login callback server on ${HOST}`, { cause });
  }).map(({ server, port }): OwnedLoopbackServer => ({
    redirectURI: `http://${HOST}:${port}${CALLBACK_PATH}`,
    callback: outcome.callback,
    [Symbol.asyncDispose]: () => {
      outcome.settle(closedEarly());
      return closeServer(server);
    },
  }));
};
