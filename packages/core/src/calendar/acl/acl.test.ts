import { describe, expect, it } from 'vitest';

import { BASE, expectInvalid, json, noContent, queryOf, serviceWith } from '../test-support';

const userRule = { kind: 'calendar#aclRule', etag: '"e"', id: 'user:ann@example.com', role: 'reader', scope: { type: 'user', value: 'ann@example.com' } };

describe('listCalendarAcl', () => {
  it('GETs calendars/{id}/acl with paging and normalizes each scope', async () => {
    const { service, calls } = serviceWith(() =>
      json({
        items: [
          userRule,
          { id: 'default', role: 'freeBusyReader', scope: { type: 'default' } },
          { id: 'group:team@example.com', role: 'writer', scope: { type: 'group', value: 'team@example.com' } },
          { id: 'domain:example.com', role: 'writerWithoutPrivateAccess', scope: { type: 'domain', value: 'example.com' } },
        ],
        nextPageToken: 'p2',
      }),
    );

    const page = (await service.listCalendarAcl({ calendarId: 'c1', maxResults: 100, page: { kind: 'next', pageToken: 'p1' } }))._unsafeUnwrap();

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/c1/acl');
    expect(queryOf(calls[0])).toEqual({ maxResults: '100', pageToken: 'p1' });
    expect(page).toEqual({
      rules: [
        { id: 'user:ann@example.com', role: 'reader', scope: { type: 'user', email: 'ann@example.com' } },
        { id: 'default', role: 'freeBusyReader', scope: { type: 'default' } },
        { id: 'group:team@example.com', role: 'writer', scope: { type: 'group', email: 'team@example.com' } },
        { id: 'domain:example.com', role: 'writerWithoutPrivateAccess', scope: { type: 'domain', domain: 'example.com' } },
      ],
      nextPage: { kind: 'next', pageToken: 'p2' },
    });
  });

  it('rejects maxResults over 250 before calling Google', async () => {
    const { service, calls } = serviceWith(() => json({ items: [] }));

    expectInvalid((await service.listCalendarAcl({ maxResults: 251, page: { kind: 'first' } }))._unsafeUnwrapErr(), ['251', '250']);
    expect(calls).toHaveLength(0);
  });
});

describe('getCalendarAclRule', () => {
  it('GETs one rule, encoding the rule id', async () => {
    const { service, calls } = serviceWith(() => json(userRule));

    const rule = (await service.getCalendarAclRule({ ruleId: 'user:ann@example.com' }))._unsafeUnwrap();

    expect(calls[0]?.url.href).toBe(`${BASE}/calendars/primary/acl/user%3Aann%40example.com`);
    expect(rule).toEqual({ id: 'user:ann@example.com', role: 'reader', scope: { type: 'user', email: 'ann@example.com' } });
  });
});

describe('insertCalendarAclRule', () => {
  it('POSTs the rule and always sends sendNotifications', async () => {
    const { service, calls } = serviceWith(() => json(userRule));

    await service.insertCalendarAclRule({ calendarId: 'c1', scope: { type: 'user', email: 'ann@example.com' }, role: 'reader', sendNotifications: false });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/c1/acl');
    expect(queryOf(calls[0])).toEqual({ sendNotifications: 'false' });
    expect(calls[0]?.body).toEqual({ role: 'reader', scope: { type: 'user', value: 'ann@example.com' } });
  });

  it.each([
    [{ type: 'default' } as const, { type: 'default' }],
    [{ type: 'group', email: 'team@example.com' } as const, { type: 'group', value: 'team@example.com' }],
    [{ type: 'domain', domain: 'example.com' } as const, { type: 'domain', value: 'example.com' }],
  ])('sends a %o scope in Google form', async (scope, expected) => {
    const { service, calls } = serviceWith(() => json(userRule));

    await service.insertCalendarAclRule({ scope, role: 'freeBusyReader', sendNotifications: true });

    expect(calls[0]?.body).toEqual({ role: 'freeBusyReader', scope: expected });
    expect(queryOf(calls[0])).toEqual({ sendNotifications: 'true' });
  });

  it.each([
    ['a user scope without an email address', { type: 'user', email: 'ann' } as const, ['"ann"', 'email']],
    ['a domain scope with an email address', { type: 'domain', domain: 'ann@example.com' } as const, ['"ann@example.com"', 'domain']],
  ])('rejects %s before calling Google', async (_label, scope, fragments) => {
    const { service, calls } = serviceWith(() => json(userRule));

    expectInvalid((await service.insertCalendarAclRule({ scope, role: 'reader', sendNotifications: false }))._unsafeUnwrapErr(), fragments);
    expect(calls).toHaveLength(0);
  });
});

describe('updateCalendarAclRule', () => {
  it('PATCHes the role with sendNotifications', async () => {
    const { service, calls } = serviceWith(() => json({ ...userRule, role: 'writer' }));

    const rule = (await service.updateCalendarAclRule({ calendarId: 'c1', ruleId: 'user:ann@example.com', role: 'writer', sendNotifications: false }))._unsafeUnwrap();

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/c1/acl/user%3Aann%40example.com');
    expect(queryOf(calls[0])).toEqual({ sendNotifications: 'false' });
    expect(calls[0]?.body).toEqual({ role: 'writer' });
    expect(rule.role).toBe('writer');
  });
});

describe('deleteCalendarAclRule', () => {
  it('DELETEs the rule', async () => {
    const { service, calls } = serviceWith(noContent);

    const result = await service.deleteCalendarAclRule({ calendarId: 'c1', ruleId: 'user:ann@example.com' });

    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url.pathname).toBe('/calendar/v3/calendars/c1/acl/user%3Aann%40example.com');
    expect(result.isOk()).toBe(true);
  });
});
