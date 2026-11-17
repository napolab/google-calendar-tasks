import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { createGoogleClient } from '../google-client';

import { createServices } from './index';

describe('createServices', () => {
  it('wires calendar and tasks to the same Google client', async () => {
    const urls: string[] = [];
    const client = createGoogleClient({
      fetch: async (input) => {
        urls.push(`${input}`);
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
      getAccessToken: () => okAsync('t'),
    });

    const services = createServices({ client });
    await services.calendar.listCalendars();
    await services.tasks.listTaskLists();

    expect(urls.map((url) => new URL(url).host)).toEqual(['www.googleapis.com', 'tasks.googleapis.com']);
  });
});
