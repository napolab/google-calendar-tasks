import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { GoogleAPIError, GoogleAuthError, GoogleNetworkError, GoogleNotFoundError, GooglePermissionError, GoogleRateLimitError, GoogleResponseParseError } from '../errors';

import { createGoogleClient } from './index';

type Captured = { url: string; init: RequestInit | undefined };

const fakeFetch = (respond: (url: string, init: RequestInit | undefined) => Response) => {
  const calls: Captured[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : `${input}`;
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fetch, calls };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const itemSchema = z.object({ id: z.string() });

const clientWith = (respond: (url: string, init: RequestInit | undefined) => Response) => {
  const fake = fakeFetch(respond);
  const client = createGoogleClient({ fetch: fake.fetch, getAccessToken: () => okAsync('token-123') });
  return { client, calls: fake.calls };
};

describe('createGoogleClient.request', () => {
  it('sends the access token as a Bearer Authorization header', async () => {
    const { client, calls } = clientWith(() => json({ id: 'a' }));

    await client.request({ method: 'GET', url: 'https://www.googleapis.com/calendar/v3/x', schema: itemSchema });

    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer token-123');
  });

  it('returns the body parsed by the schema', async () => {
    const { client } = clientWith(() => json({ id: 'a', extra: true }));

    const result = await client.request({ method: 'GET', url: 'https://www.googleapis.com/calendar/v3/x', schema: itemSchema });

    expect(result._unsafeUnwrap()).toEqual({ id: 'a' });
  });

  it('appends query parameters and skips undefined ones', async () => {
    const { client, calls } = clientWith(() => json({ id: 'a' }));

    await client.request({ method: 'GET', url: 'https://www.googleapis.com/calendar/v3/x', query: { maxResults: 10, singleEvents: true, pageToken: undefined }, schema: itemSchema });

    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('maxResults')).toBe('10');
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.has('pageToken')).toBe(false);
  });

  it('sends a JSON body with a content-type header', async () => {
    const { client, calls } = clientWith(() => json({ id: 'a' }));

    await client.request({ method: 'POST', url: 'https://www.googleapis.com/calendar/v3/x', body: { summary: 'hi' }, schema: itemSchema });

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe('{"summary":"hi"}');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
  });

  it('accepts an empty 204 response when the schema is z.void-like', async () => {
    const { client } = clientWith(() => new Response(null, { status: 204 }));

    const result = await client.request({ method: 'DELETE', url: 'https://www.googleapis.com/calendar/v3/x', schema: z.undefined() });

    expect(result.isOk()).toBe(true);
  });

  it.each([
    [401, GoogleAuthError],
    [403, GooglePermissionError],
    [404, GoogleNotFoundError],
    [410, GoogleNotFoundError],
    [429, GoogleRateLimitError],
    [500, GoogleAPIError],
  ])('maps HTTP %i to its error class', async (status, ErrorClass) => {
    const { client } = clientWith(() => json({ error: { code: status, message: 'boom' } }, status));

    const result = await client.request({ method: 'GET', url: 'https://www.googleapis.com/calendar/v3/x', schema: itemSchema });

    const error = result._unsafeUnwrapErr();
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error.message).toContain('boom');
  });

  it('keeps the HTTP status on GoogleAPIError', async () => {
    const { client } = clientWith(() => json({ error: { code: 502, message: 'bad gateway' } }, 502));

    const error = (await client.request({ method: 'GET', url: 'https://www.googleapis.com/calendar/v3/x', schema: itemSchema }))._unsafeUnwrapErr();

    expect(error).toBeInstanceOf(GoogleAPIError);
    expect(error instanceof GoogleAPIError && error.status).toBe(502);
  });

  it('fails with GoogleResponseParseError when the body does not match the schema', async () => {
    const { client } = clientWith(() => json({ nope: 1 }));

    const result = await client.request({ method: 'GET', url: 'https://www.googleapis.com/calendar/v3/x', schema: itemSchema });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleResponseParseError);
  });

  it('fails with GoogleNetworkError when fetch rejects', async () => {
    const client = createGoogleClient({
      fetch: async () => {
        throw new TypeError('network down');
      },
      getAccessToken: () => okAsync('t'),
    });

    const result = await client.request({ method: 'GET', url: 'https://www.googleapis.com/calendar/v3/x', schema: itemSchema });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleNetworkError);
  });

  it('does not call fetch when the access token cannot be obtained', async () => {
    const fake = fakeFetch(() => json({ id: 'a' }));
    const client = createGoogleClient({ fetch: fake.fetch, getAccessToken: () => errAsync(new GoogleAuthError('refresh token revoked')) });

    const result = await client.request({ method: 'GET', url: 'https://www.googleapis.com/calendar/v3/x', schema: itemSchema });

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoogleAuthError);
    expect(fake.calls).toHaveLength(0);
  });
});
