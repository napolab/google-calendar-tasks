import { z } from 'zod';

import { ok, toToolError } from '../../tool-result';
import { READ_ONLY } from '../shared';

import type { ToolDeps } from '../../tool-deps';
import type { ToolResult } from '../../tool-result';
import type { McpServer } from '@modelcontextprotocol/server';

// Read-only reference data: the color palettes (for colorId arguments) and the user's Calendar settings.

export const getSettingArgs = z.strictObject({
  settingId: z.string().min(1).describe('Setting id, e.g. "timezone", "weekStart", "locale", "defaultEventLength", "format24HourTime". list_settings returns them all.'),
});

export type GetSettingArgs = z.output<typeof getSettingArgs>;

export const createColorsSettingsToolHandlers = (deps: ToolDeps) => {
  const { calendar } = deps.services;
  const fail = toToolError(deps.connectURL);

  return {
    getColors: (): Promise<ToolResult> => calendar.getColors().match(ok, fail),

    listSettings: (): Promise<ToolResult> =>
      calendar
        .listSettings()
        .map((settings) => ({ settings }))
        .match(ok, fail),

    getSetting: (args: GetSettingArgs): Promise<ToolResult> => calendar.getSetting({ settingId: args.settingId }).match(ok, fail),
  };
};

export const registerColorsSettingsTools = (server: McpServer, deps: ToolDeps): void => {
  const handlers = createColorsSettingsToolHandlers(deps);

  server.registerTool(
    'get_colors',
    {
      title: 'Get color palettes',
      description:
        'The color palettes: `event` ids are valid event colorId values (create_event / update_event), `calendar` ids are valid calendar list colorId values. Each has background / foreground hex.',
      annotations: READ_ONLY,
    },
    handlers.getColors,
  );

  server.registerTool(
    'list_settings',
    {
      title: 'List calendar settings',
      description:
        "The user's Calendar settings as { id, value } strings (timezone, weekStart 0=Sunday, locale, defaultEventLength minutes, format24HourTime, ...). Settings at their default may be absent.",
      annotations: READ_ONLY,
    },
    handlers.listSettings,
  );

  server.registerTool(
    'get_setting',
    { title: 'Get calendar setting', description: 'One Calendar setting by id, e.g. "timezone" → "Asia/Tokyo".', inputSchema: getSettingArgs, annotations: READ_ONLY },
    handlers.getSetting,
  );
};
