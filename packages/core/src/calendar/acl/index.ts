import { Result, err, ok } from 'neverthrow';
import { z } from 'zod';

import { InvalidInputError } from '../../errors';
import { aclRuleURL, aclURL, calendarIdOf, pageQuery } from '../request';
import { emptySchema, toNextPage } from '../schemas';
import { validateMaxResults } from '../validation';

import type { GoogleError } from '../../errors';
import type { GoogleClient } from '../../google-client';
import type { AclPage, AclRule, AclRuleRef, AclScope, InsertAclRuleInput, ListCalendarAclInput, UpdateAclRuleInput } from '../index';
import type { ResultAsync } from 'neverthrow';

// acl.*: who a calendar is shared with. Google calls the "who" a scope: `default` (public), a user, a group or a domain.

const ACL_PAGE_LIMIT = 250;

const scopeSchema = z.object({ type: z.enum(['default', 'user', 'group', 'domain']), value: z.string().nullish() });

const toScope = (wire: z.output<typeof scopeSchema>): AclScope => {
  const value = wire.value ?? '';
  switch (wire.type) {
    case 'default':
      return { type: 'default' };
    case 'user':
    case 'group':
      return { type: wire.type, email: value };
    case 'domain':
      return { type: 'domain', domain: value };
    default: {
      const _exhaustive: never = wire.type;
      throw new Error(`unhandled scope: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const aclRuleSchema: z.ZodType<AclRule> = z
  .object({ id: z.string(), role: z.enum(['none', 'freeBusyReader', 'reader', 'writerWithoutPrivateAccess', 'writer', 'owner']), scope: scopeSchema })
  .transform((rule) => ({ id: rule.id, role: rule.role, scope: toScope(rule.scope) }));

const aclPageSchema: z.ZodType<AclPage> = z
  .object({ items: z.array(aclRuleSchema).nullish(), nextPageToken: z.string().nullish() })
  .transform((page) => ({ rules: page.items ?? [], nextPage: toNextPage(page.nextPageToken) }));

// ---- scope (insert) ----

const emailSchema = z.email();

const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

const validateEmail = (type: 'user' | 'group', email: string): Result<string, InvalidInputError> => {
  if (emailSchema.safeParse(email).success) return ok(email);
  return err(new InvalidInputError(`scope ${type} "${email}" is not an email address. Pass the ${type}'s email, e.g. "name@example.com", or use a domain scope for a whole domain.`));
};

const validateDomain = (domain: string): Result<string, InvalidInputError> => {
  if (DOMAIN.test(domain)) return ok(domain);
  return err(new InvalidInputError(`scope domain "${domain}" is not a domain name. Pass a domain such as "example.com" (no "@"), or use a user scope for one person.`));
};

const validateScope = (scope: AclScope): Result<AclScope, InvalidInputError> => {
  switch (scope.type) {
    case 'default':
      return ok(scope);
    case 'user':
    case 'group':
      return validateEmail(scope.type, scope.email).map(() => scope);
    case 'domain':
      return validateDomain(scope.domain).map(() => scope);
    default: {
      const _exhaustive: never = scope;
      throw new Error(`unhandled scope: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

type ScopeBody = { readonly type: AclScope['type']; readonly value: string | undefined };

const toScopeBody = (scope: AclScope): ScopeBody => {
  switch (scope.type) {
    case 'default':
      return { type: scope.type, value: undefined };
    case 'user':
    case 'group':
      return { type: scope.type, value: scope.email };
    case 'domain':
      return { type: scope.type, value: scope.domain };
    default: {
      const _exhaustive: never = scope;
      throw new Error(`unhandled scope: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// ---- operations ----

export const listCalendarAcl = (client: GoogleClient, input: ListCalendarAclInput): ResultAsync<AclPage, GoogleError | InvalidInputError> =>
  validateMaxResults(input.maxResults, ACL_PAGE_LIMIT).asyncAndThen(() =>
    client.request({ method: 'GET', url: aclURL(calendarIdOf(input)), query: { maxResults: input.maxResults, pageToken: pageQuery(input.page) }, schema: aclPageSchema }),
  );

export const getCalendarAclRule = (client: GoogleClient, input: AclRuleRef): ResultAsync<AclRule, GoogleError> =>
  client.request({ method: 'GET', url: aclRuleURL(calendarIdOf(input), input.ruleId), schema: aclRuleSchema });

// sendNotifications is always sent: Google's default (true) would email the grantee.
export const insertCalendarAclRule = (client: GoogleClient, input: InsertAclRuleInput): ResultAsync<AclRule, GoogleError | InvalidInputError> =>
  validateScope(input.scope).asyncAndThen((scope) =>
    client.request({
      method: 'POST',
      url: aclURL(calendarIdOf(input)),
      query: { sendNotifications: input.sendNotifications },
      body: { role: input.role, scope: toScopeBody(scope) },
      schema: aclRuleSchema,
    }),
  );

export const updateCalendarAclRule = (client: GoogleClient, input: UpdateAclRuleInput): ResultAsync<AclRule, GoogleError> =>
  client.request({ method: 'PATCH', url: aclRuleURL(calendarIdOf(input), input.ruleId), query: { sendNotifications: input.sendNotifications }, body: { role: input.role }, schema: aclRuleSchema });

export const deleteCalendarAclRule = (client: GoogleClient, input: AclRuleRef): ResultAsync<void, GoogleError> =>
  client.request({ method: 'DELETE', url: aclRuleURL(calendarIdOf(input), input.ruleId), schema: emptySchema }).map(() => undefined);
