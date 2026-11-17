import { registerAclTools } from './acl';
import { registerCalendarListTools } from './calendar-list';
import { registerCalendarsTools } from './calendars';
import { registerColorsSettingsTools } from './colors-settings';
import { registerEventTools } from './events';

import type { ToolDeps } from '../tool-deps';
import type { McpServer } from '@modelcontextprotocol/server';

// Every Google Calendar tool, one module per API resource. Push notifications (events / calendarList / acl /
// settings .watch, channels.stop) are not exposed: they need an HTTPS webhook receiver, not a tool call.
export const registerCalendarTools = (server: McpServer, deps: ToolDeps): void => {
  registerEventTools(server, deps);
  registerCalendarsTools(server, deps);
  registerCalendarListTools(server, deps);
  registerAclTools(server, deps);
  registerColorsSettingsTools(server, deps);
};
