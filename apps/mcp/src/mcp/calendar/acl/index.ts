import { InvalidInputError } from '@napolab/gct-core/errors';
import { Result, err, ok as okResult } from 'neverthrow';
import { z } from 'zod';

import { ok, toToolError } from '../../tool-result';
import { ADDITIVE, DESTRUCTIVE, PRIMARY_CALENDAR, READ_ONLY, calendarIdArg, calendarOf, nextPageToken } from '../shared';

import type { ToolDeps } from '../../tool-deps';
import type { ToolResult } from '../../tool-result';
import type { AclRole, AclRuleRef, InsertAclRuleInput, ListCalendarAclInput, UpdateAclRuleInput } from '@napolab/gct-core/calendar';
import type { McpServer } from '@modelcontextprotocol/server';

// Sharing tools (calendar ACL). They change who can see or edit a calendar, so the descriptions say so, the grantee is
// not emailed unless asked, and making someone an owner needs an explicit confirmation literal.

const DEFAULT_ACL_PAGE = 100;

const OWNER_CONFIRMATION = 'grant-owner';

const SENSITIVE = 'SENSITIVE: changes who can see the calendar — only do this when the user asked for it.';

// ---- arguments ----

const roleArg = z
  .enum(['none', 'freeBusyReader', 'reader', 'writerWithoutPrivateAccess', 'writer', 'owner'])
  .describe(
    "freeBusyReader = busy times only; reader = events (private ones hidden); writerWithoutPrivateAccess = edit, private details hidden; writer = edit + see private details; owner = writer + manage sharing (needs confirm: 'grant-owner'); none = no access.",
  );

const scopeArg = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('default') }),
    z.strictObject({ type: z.literal('user'), email: z.string() }),
    z.strictObject({ type: z.literal('group'), email: z.string() }),
    z.strictObject({ type: z.literal('domain'), domain: z.string().describe('e.g. "example.com"') }),
  ])
  .describe("Who: { type: 'user', email } | { type: 'group', email } | { type: 'domain', domain } | { type: 'default' } (= PUBLIC, anyone on the internet).");

const ruleIdArg = z.string().min(1).describe('Rule id from list_calendar_acl, e.g. "user:ann@example.com".');

const sendNotificationsArg = z.boolean().optional().describe('true emails the grantee about the change. Default false (no email).');

const confirmArg = z.literal(OWNER_CONFIRMATION).optional().describe(`Required (exactly '${OWNER_CONFIRMATION}') only when role is 'owner'.`);

export const listCalendarAclArgs = z.strictObject({
  calendarId: calendarIdArg,
  maxResults: z.number().int().min(1).max(250).optional().describe(`Rules per page, 1-250. Default: ${DEFAULT_ACL_PAGE}.`),
  pageToken: z.string().min(1).optional().describe('nextPageToken from the previous call with the same arguments.'),
});

export const aclRuleRefArgs = z.strictObject({ calendarId: calendarIdArg, ruleId: ruleIdArg });

export const shareCalendarArgs = z.strictObject({ calendarId: calendarIdArg, scope: scopeArg, role: roleArg, sendNotifications: sendNotificationsArg, confirm: confirmArg });

export const updateCalendarAclRuleArgs = z.strictObject({ calendarId: calendarIdArg, ruleId: ruleIdArg, role: roleArg, sendNotifications: sendNotificationsArg, confirm: confirmArg });

export type ListCalendarAclArgs = z.output<typeof listCalendarAclArgs>;
export type AclRuleRefArgs = z.output<typeof aclRuleRefArgs>;
export type ShareCalendarArgs = z.output<typeof shareCalendarArgs>;
export type UpdateCalendarAclRuleArgs = z.output<typeof updateCalendarAclRuleArgs>;

// ---- mapping ----

// Granting owner hands over control of sharing; it needs the literal, and the literal means nothing for other roles.
const requireOwnerConfirmation = (role: AclRole, confirm: typeof OWNER_CONFIRMATION | undefined): Result<AclRole, InvalidInputError> => {
  if (role === 'owner' && confirm === undefined)
    return err(
      new InvalidInputError(
        `role 'owner' lets the grantee manage the calendar and its sharing (including removing the user). Only grant it when the user explicitly asked for owner, and then pass confirm: '${OWNER_CONFIRMATION}'. Otherwise use 'writer'.`,
      ),
    );
  if (role !== 'owner' && confirm !== undefined) return err(new InvalidInputError(`confirm: '${OWNER_CONFIRMATION}' is only for role 'owner'; remove confirm for role '${role}'.`));
  return okResult(role);
};

export const toListCalendarAclInput = (args: ListCalendarAclArgs): ListCalendarAclInput => ({
  ...calendarOf(args.calendarId),
  maxResults: args.maxResults ?? DEFAULT_ACL_PAGE,
  page: args.pageToken === undefined ? { kind: 'first' } : { kind: 'next', pageToken: args.pageToken },
});

export const toAclRuleRef = (args: AclRuleRefArgs): AclRuleRef => ({ ...calendarOf(args.calendarId), ruleId: args.ruleId });

export const toInsertAclRuleInput = (args: ShareCalendarArgs): Result<InsertAclRuleInput, InvalidInputError> =>
  requireOwnerConfirmation(args.role, args.confirm).map((role) => ({ ...calendarOf(args.calendarId), scope: args.scope, role, sendNotifications: args.sendNotifications ?? false }));

export const toUpdateAclRuleInput = (args: UpdateCalendarAclRuleArgs): Result<UpdateAclRuleInput, InvalidInputError> =>
  requireOwnerConfirmation(args.role, args.confirm).map((role) => ({ ...toAclRuleRef(args), role, sendNotifications: args.sendNotifications ?? false }));

// ---- tools ----

export const createAclToolHandlers = (deps: ToolDeps) => {
  const { calendar } = deps.services;
  const fail = toToolError(deps.connectURL, 'acl');

  return {
    listCalendarAcl: (args: ListCalendarAclArgs): Promise<ToolResult> =>
      calendar
        .listCalendarAcl(toListCalendarAclInput(args))
        .map((page) => ({ calendarId: args.calendarId ?? PRIMARY_CALENDAR, rules: page.rules, nextPageToken: nextPageToken(page.nextPage) }))
        .match(ok, fail),

    getCalendarAclRule: (args: AclRuleRefArgs): Promise<ToolResult> => calendar.getCalendarAclRule(toAclRuleRef(args)).match(ok, fail),

    shareCalendar: (args: ShareCalendarArgs): Promise<ToolResult> =>
      toInsertAclRuleInput(args)
        .asyncAndThen((input) => calendar.insertCalendarAclRule(input))
        .match(ok, fail),

    updateCalendarAclRule: (args: UpdateCalendarAclRuleArgs): Promise<ToolResult> =>
      toUpdateAclRuleInput(args)
        .asyncAndThen((input) => calendar.updateCalendarAclRule(input))
        .match(ok, fail),

    unshareCalendar: (args: AclRuleRefArgs): Promise<ToolResult> =>
      calendar
        .deleteCalendarAclRule(toAclRuleRef(args))
        .map(() => ({ unshared: true, calendarId: args.calendarId ?? PRIMARY_CALENDAR, ruleId: args.ruleId }))
        .match(ok, fail),
  };
};

export const registerAclTools = (server: McpServer, deps: ToolDeps): void => {
  const handlers = createAclToolHandlers(deps);

  server.registerTool(
    'list_calendar_acl',
    {
      title: 'List calendar sharing',
      description: 'List who a calendar is shared with (ACL rules: id, role, scope). Rule ids feed get / update_calendar_acl_rule and unshare_calendar.',
      inputSchema: listCalendarAclArgs,
      annotations: READ_ONLY,
    },
    handlers.listCalendarAcl,
  );

  server.registerTool(
    'get_calendar_acl_rule',
    { title: 'Get calendar sharing rule', description: 'Get one sharing rule (role and scope) by id.', inputSchema: aclRuleRefArgs, annotations: READ_ONLY },
    handlers.getCalendarAclRule,
  );

  server.registerTool(
    'share_calendar',
    {
      title: 'Share calendar',
      description: `${SENSITIVE} Give a user, group, domain or everyone (type 'default' = PUBLIC) a role on a calendar. To change an existing rule's role use update_calendar_acl_rule. No email is sent unless sendNotifications: true.`,
      inputSchema: shareCalendarArgs,
      annotations: ADDITIVE,
    },
    handlers.shareCalendar,
  );

  server.registerTool(
    'update_calendar_acl_rule',
    {
      title: 'Change calendar sharing role',
      description: `${SENSITIVE} Change the role of an existing sharing rule (lowering it removes access). No email is sent unless sendNotifications: true.`,
      inputSchema: updateCalendarAclRuleArgs,
      annotations: DESTRUCTIVE,
    },
    handlers.updateCalendarAclRule,
  );

  server.registerTool(
    'unshare_calendar',
    {
      title: 'Unshare calendar',
      description: `${SENSITIVE} Remove a sharing rule: that user / group / domain (or the public) loses access. Confirm the rule with get_calendar_acl_rule first.`,
      inputSchema: aclRuleRefArgs,
      annotations: DESTRUCTIVE,
    },
    handlers.unshareCalendar,
  );
};
