import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { depsWith, errorTextOf, jsonOf, recorder } from '../test-support';
import { createAclToolHandlers } from './index';

import type { AclRule, AclRuleRef, ICalendarService, InsertAclRuleInput, ListCalendarAclInput, UpdateAclRuleInput } from '@napolab/gct-core/calendar';

const rule: AclRule = { id: 'user:ann@example.com', role: 'reader', scope: { type: 'user', email: 'ann@example.com' } };

const handlersWith = (overrides: Partial<ICalendarService>) => createAclToolHandlers(depsWith(overrides));

describe('acl tools', () => {
  it('list_calendar_acl defaults to 100 per page and returns the next page token', async () => {
    const list = recorder((_input: ListCalendarAclInput) => okAsync({ rules: [rule], nextPage: { kind: 'none' as const } }));
    const handlers = handlersWith({ listCalendarAcl: list.fn });

    expect(jsonOf(await handlers.listCalendarAcl({ calendarId: 'c1' }))).toEqual({ calendarId: 'c1', rules: [rule], nextPageToken: null });
    expect(list.calls).toEqual([{ calendarId: 'c1', maxResults: 100, page: { kind: 'first' } }]);
  });

  it('get_calendar_acl_rule returns the rule', async () => {
    const get = recorder((_input: AclRuleRef) => okAsync(rule));
    const handlers = handlersWith({ getCalendarAclRule: get.fn });

    expect(jsonOf(await handlers.getCalendarAclRule({ ruleId: rule.id }))).toEqual(rule);
    expect(get.calls).toEqual([{ ruleId: rule.id }]);
  });

  it('share_calendar does not email the grantee by default', async () => {
    const insert = recorder((_input: InsertAclRuleInput) => okAsync(rule));
    const handlers = handlersWith({ insertCalendarAclRule: insert.fn });

    expect(jsonOf(await handlers.shareCalendar({ calendarId: 'c1', scope: { type: 'user', email: 'ann@example.com' }, role: 'reader' }))).toEqual(rule);
    expect(insert.calls).toEqual([{ calendarId: 'c1', scope: { type: 'user', email: 'ann@example.com' }, role: 'reader', sendNotifications: false }]);
  });

  it('share_calendar refuses the owner role without the confirmation literal', async () => {
    const handlers = handlersWith({});

    expect(errorTextOf(await handlers.shareCalendar({ scope: { type: 'user', email: 'ann@example.com' }, role: 'owner' }))).toContain("confirm: 'grant-owner'");
  });

  it('share_calendar grants owner with the confirmation literal', async () => {
    const insert = recorder((_input: InsertAclRuleInput) => okAsync({ ...rule, role: 'owner' as const }));
    const handlers = handlersWith({ insertCalendarAclRule: insert.fn });

    await handlers.shareCalendar({ scope: { type: 'domain', domain: 'example.com' }, role: 'owner', confirm: 'grant-owner', sendNotifications: true });

    expect(insert.calls).toEqual([{ scope: { type: 'domain', domain: 'example.com' }, role: 'owner', sendNotifications: true }]);
  });

  it('share_calendar rejects the confirmation literal on another role', async () => {
    const handlers = handlersWith({});

    expect(errorTextOf(await handlers.shareCalendar({ scope: { type: 'default' }, role: 'reader', confirm: 'grant-owner' }))).toContain('only');
  });

  it('update_calendar_acl_rule applies the same owner guard and no-email default', async () => {
    const update = recorder((_input: UpdateAclRuleInput) => okAsync(rule));
    const handlers = handlersWith({ updateCalendarAclRule: update.fn });

    expect(errorTextOf(await handlers.updateCalendarAclRule({ ruleId: rule.id, role: 'owner' }))).toContain("confirm: 'grant-owner'");
    await handlers.updateCalendarAclRule({ ruleId: rule.id, role: 'writer' });
    expect(update.calls).toEqual([{ ruleId: rule.id, role: 'writer', sendNotifications: false }]);
  });

  it('unshare_calendar confirms what was removed', async () => {
    const remove = recorder((_input: AclRuleRef) => okAsync(undefined));
    const handlers = handlersWith({ deleteCalendarAclRule: remove.fn });

    expect(jsonOf(await handlers.unshareCalendar({ calendarId: 'c1', ruleId: rule.id }))).toEqual({ unshared: true, calendarId: 'c1', ruleId: rule.id });
  });
});
