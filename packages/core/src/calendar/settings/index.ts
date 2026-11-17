import { okAsync } from 'neverthrow';
import { z } from 'zod';

import { pageQuery, settingURL, settingsURL } from '../request';
import { toNextPage } from '../schemas';
import { validateNonEmpty } from '../validation';

import type { GoogleError, InvalidInputError } from '../../errors';
import type { GoogleClient } from '../../google-client';
import type { NextPage, PageRequest, Setting, SettingRef } from '../index';
import type { ResultAsync } from 'neverthrow';

// settings.list / settings.get: the user's Calendar preferences (time zone, week start, locale, ...). Read-only.

const SETTINGS_PAGE_LIMIT = 250;

const settingSchema: z.ZodType<Setting> = z.object({ id: z.string(), value: z.string() }).transform((setting) => ({ id: setting.id, value: setting.value }));

type SettingsPage = { readonly items: readonly Setting[]; readonly nextPage: NextPage };

const settingsPageSchema: z.ZodType<SettingsPage> = z
  .object({ items: z.array(settingSchema).nullish(), nextPageToken: z.string().nullish() })
  .transform((page) => ({ items: page.items ?? [], nextPage: toNextPage(page.nextPageToken) }));

// Walks every page, accumulating settings until there is no next page.
const listSettingsFrom = (client: GoogleClient, page: PageRequest, collected: readonly Setting[]): ResultAsync<readonly Setting[], GoogleError> =>
  client.request({ method: 'GET', url: settingsURL, query: { maxResults: SETTINGS_PAGE_LIMIT, pageToken: pageQuery(page) }, schema: settingsPageSchema }).andThen((result) => {
    const settings = [...collected, ...result.items];
    switch (result.nextPage.kind) {
      case 'none':
        return okAsync(settings);
      case 'next':
        return listSettingsFrom(client, result.nextPage, settings);
      default: {
        const _exhaustive: never = result.nextPage;
        throw new Error(`unhandled page: ${JSON.stringify(_exhaustive)}`);
      }
    }
  });

export const listSettings = (client: GoogleClient): ResultAsync<readonly Setting[], GoogleError> => listSettingsFrom(client, { kind: 'first' }, []);

export const getSetting = (client: GoogleClient, input: SettingRef): ResultAsync<Setting, GoogleError | InvalidInputError> =>
  validateNonEmpty('settingId', input.settingId, 'Pass a setting id such as "timezone" or "weekStart"; list_settings returns every id.').asyncAndThen(() =>
    client.request({ method: 'GET', url: settingURL(input.settingId), schema: settingSchema }),
  );
