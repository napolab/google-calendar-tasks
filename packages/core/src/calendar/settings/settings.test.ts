import { describe, expect, it } from 'vitest';

import { BASE, expectInvalid, json, serviceWith } from '../test-support';

describe('listSettings', () => {
  it('GETs every page of users/me/settings and keeps id and value', async () => {
    const { service, calls } = serviceWith(
      () => json({ kind: 'calendar#settings', items: [{ kind: 'calendar#setting', etag: '"e"', id: 'timezone', value: 'Asia/Tokyo' }], nextPageToken: 'p2' }),
      () => json({ items: [{ id: 'weekStart', value: '1' }] }),
    );

    const settings = (await service.listSettings())._unsafeUnwrap();

    expect(calls).toHaveLength(2);
    expect(`${calls[0]?.url.origin}${calls[0]?.url.pathname}`).toBe(`${BASE}/users/me/settings`);
    expect(calls[0]?.url.searchParams.get('maxResults')).toBe('250');
    expect(calls[1]?.url.searchParams.get('pageToken')).toBe('p2');
    expect(settings).toEqual([
      { id: 'timezone', value: 'Asia/Tokyo' },
      { id: 'weekStart', value: '1' },
    ]);
  });
});

describe('getSetting', () => {
  it('GETs users/me/settings/{id}', async () => {
    const { service, calls } = serviceWith(() => json({ id: 'locale', value: 'ja' }));

    const setting = (await service.getSetting({ settingId: 'locale' }))._unsafeUnwrap();

    expect(calls[0]?.url.href).toBe(`${BASE}/users/me/settings/locale`);
    expect(setting).toEqual({ id: 'locale', value: 'ja' });
  });

  it('rejects an empty id before calling Google', async () => {
    const { service, calls } = serviceWith(() => json({}));

    expectInvalid((await service.getSetting({ settingId: '' }))._unsafeUnwrapErr(), ['settingId', 'list_settings']);
    expect(calls).toHaveLength(0);
  });
});
