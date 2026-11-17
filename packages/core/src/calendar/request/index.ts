import type { PageRequest, SendUpdates } from '../index';

// URL building and query helpers shared by every Calendar v3 resource module.

export const BASE_URL = 'https://www.googleapis.com/calendar/v3';

export const PRIMARY_CALENDAR = 'primary';

// `calendarId` is the one optional input field across the calendar service: omitted means Google's own alias 'primary'.
export const calendarIdOf = (input: { readonly calendarId?: string }): string => input.calendarId ?? PRIMARY_CALENDAR;

// Calendar ids look like `ja.japanese#holiday@group.v.calendar.google.com` and ACL rule ids like `user:a@b`,
// so every path segment is encoded.
export const calendarURL = (calendarId: string): string => `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}`;

export const eventsURL = (calendarId: string): string => `${calendarURL(calendarId)}/events`;

export const eventURL = (calendarId: string, eventId: string): string => `${eventsURL(calendarId)}/${encodeURIComponent(eventId)}`;

export const calendarListURL: string = `${BASE_URL}/users/me/calendarList`;

export const calendarListEntryURL = (calendarId: string): string => `${calendarListURL}/${encodeURIComponent(calendarId)}`;

export const aclURL = (calendarId: string): string => `${calendarURL(calendarId)}/acl`;

export const aclRuleURL = (calendarId: string, ruleId: string): string => `${aclURL(calendarId)}/${encodeURIComponent(ruleId)}`;

export const settingsURL: string = `${BASE_URL}/users/me/settings`;

export const settingURL = (settingId: string): string => `${settingsURL}/${encodeURIComponent(settingId)}`;

export const pageQuery = (page: PageRequest): string | undefined => {
  switch (page.kind) {
    case 'first':
      return undefined;
    case 'next':
      return page.pageToken;
    default: {
      const _exhaustive: never = page;
      throw new Error(`unhandled page: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Notification emails are a query parameter on every event write; it is always sent so Google's own default never applies.
export const sendUpdatesQuery = (sendUpdates: SendUpdates): { readonly sendUpdates: SendUpdates } => ({ sendUpdates });
