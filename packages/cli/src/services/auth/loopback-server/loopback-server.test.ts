import { afterEach, describe, expect, it } from 'vitest';

import { LoginTimeoutError } from '../../../context/errors';

import { startLoopbackServer } from './index';

import type { OwnedLoopbackServer } from './index';

const STATE = 'state-123';

describe('startLoopbackServer', () => {
  let server: OwnedLoopbackServer | undefined;

  const start = async (signal: AbortSignal = AbortSignal.timeout(5_000)) => {
    server = (await startLoopbackServer({ expectedState: STATE, signal }))._unsafeUnwrap();
    return server;
  };

  afterEach(async () => {
    await server?.[Symbol.asyncDispose]();
    server = undefined;
  });

  it('listens on an ephemeral 127.0.0.1 port and exposes /callback on it as the redirect URI', async () => {
    const { redirectURI } = await start();

    expect(redirectURI).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  it('resolves the callback with the code from a valid redirect and shows a "close this tab" page', async () => {
    const loopback = await start();

    const response = await fetch(`${loopback.redirectURI}?state=${STATE}&code=code-1`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('close this tab');
    expect((await loopback.callback)._unsafeUnwrap()).toEqual({ kind: 'code', code: 'code-1' });
  });

  it('is already waiting when it starts: a redirect before anyone awaits the callback is kept', async () => {
    const loopback = await start();

    await fetch(`${loopback.redirectURI}?state=${STATE}&code=early`);

    expect((await loopback.callback)._unsafeUnwrap()).toEqual({ kind: 'code', code: 'early' });
  });

  it('answers unrelated requests with 404 and keeps waiting', async () => {
    const loopback = await start();

    const favicon = await fetch(new URL('/favicon.ico', loopback.redirectURI));
    await fetch(`${loopback.redirectURI}?state=${STATE}&code=code-2`);

    expect(favicon.status).toBe(404);
    expect((await loopback.callback)._unsafeUnwrap()).toEqual({ kind: 'code', code: 'code-2' });
  });

  it('resolves with an invalid callback (and answers 400) on a state mismatch', async () => {
    const loopback = await start();

    const response = await fetch(`${loopback.redirectURI}?state=forged&code=code-1`);

    expect(response.status).toBe(400);
    expect((await loopback.callback)._unsafeUnwrap()).toEqual({ kind: 'invalid', reason: 'state-mismatch' });
  });

  it('resolves with the OAuth error Google reported', async () => {
    const loopback = await start();

    await fetch(`${loopback.redirectURI}?state=${STATE}&error=access_denied`);

    expect((await loopback.callback)._unsafeUnwrap()).toEqual({ kind: 'error', error: 'access_denied' });
  });

  it('keeps the first callback when the browser comes back again', async () => {
    const loopback = await start();

    await fetch(`${loopback.redirectURI}?state=${STATE}&code=first`);
    await fetch(`${loopback.redirectURI}?state=${STATE}&code=second`);

    expect((await loopback.callback)._unsafeUnwrap()).toEqual({ kind: 'code', code: 'first' });
  });

  it('fails the callback with LoginTimeoutError when the signal aborts first', async () => {
    const loopback = await start(AbortSignal.timeout(20));

    expect((await loopback.callback)._unsafeUnwrapErr()).toBeInstanceOf(LoginTimeoutError);
  });

  it('fails the callback with LoginTimeoutError right away for an already-aborted signal', async () => {
    const loopback = await start(AbortSignal.abort());

    expect((await loopback.callback)._unsafeUnwrapErr()).toBeInstanceOf(LoginTimeoutError);
  });

  it('fails a pending callback with LoginTimeoutError and stops accepting connections when disposed', async () => {
    const loopback = await start();

    await loopback[Symbol.asyncDispose]();

    expect((await loopback.callback)._unsafeUnwrapErr()).toBeInstanceOf(LoginTimeoutError);
    await expect(fetch(loopback.redirectURI)).rejects.toThrow();
  });
});
