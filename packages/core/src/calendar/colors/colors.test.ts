import { describe, expect, it } from 'vitest';

import { BASE, json, serviceWith } from '../test-support';

describe('getColors', () => {
  it('GETs the color palettes as id-ordered lists', async () => {
    const { service, calls } = serviceWith(() =>
      json({
        kind: 'calendar#colors',
        updated: '2012-02-14T00:00:00.000Z',
        calendar: { '2': { background: '#d06b64', foreground: '#1d1d1d' }, '1': { background: '#ac725e', foreground: '#1d1d1d' } },
        event: { '11': { background: '#dc2127', foreground: '#1d1d1d' }, '1': { background: '#a4bdfc', foreground: '#1d1d1d' } },
      }),
    );

    const colors = (await service.getColors())._unsafeUnwrap();

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url.href).toBe(`${BASE}/colors`);
    expect(colors).toEqual({
      calendar: [
        { id: '1', background: '#ac725e', foreground: '#1d1d1d' },
        { id: '2', background: '#d06b64', foreground: '#1d1d1d' },
      ],
      event: [
        { id: '1', background: '#a4bdfc', foreground: '#1d1d1d' },
        { id: '11', background: '#dc2127', foreground: '#1d1d1d' },
      ],
    });
  });
});
