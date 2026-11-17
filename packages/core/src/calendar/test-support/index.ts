import { okAsync } from 'neverthrow';
import { expect } from 'vitest';

import { InvalidInputError } from '../../errors';
import { createGoogleClient } from '../../google-client';
import { createCalendarService } from '../index';

import type { ICalendarService } from '../index';

// Test helpers shared by the calendar resource tests: a fake Google that records every request.

export type Captured = { readonly url: URL; readonly method: string; readonly body: unknown };

export const BASE = 'https://www.googleapis.com/calendar/v3';

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const noContent = (): Response => new Response(null, { status: 204 });

// Answers each request with the next canned response (the last one repeats) and records what was sent.
export const serviceWith = (...responses: readonly (() => Response)[]): { readonly service: ICalendarService; readonly calls: Captured[] } => {
  const calls: Captured[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: new URL(input instanceof Request ? input.url : `${input}`), method: init?.method ?? 'GET', body });
    const respond = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (respond === undefined) throw new Error('no canned response');
    return respond();
  };
  const client = createGoogleClient({ fetch, getAccessToken: () => okAsync('token') });
  return { service: createCalendarService({ client }), calls };
};

export const queryOf = (call: Captured | undefined): Readonly<Record<string, string>> => Object.fromEntries(call?.url.searchParams ?? []);

export const expectInvalid = (error: Error, fragments: readonly string[]): void => {
  expect(error).toBeInstanceOf(InvalidInputError);
  for (const fragment of fragments) expect(error.message).toContain(fragment);
};
