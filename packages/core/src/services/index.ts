import { createCalendarService } from '../calendar';
import { createTasksService } from '../tasks';

import type { ICalendarService } from '../calendar';
import type { GoogleClient } from '../google-client';
import type { ITasksService } from '../tasks';

// The services map injected into every edge (CLI commands, Hono `Variables.services` in apps/mcp).
// Mirrors Genovese / request-invite-system `shared/callable` `Services` (.claude/rules/shared.md).
export type Services = {
  readonly calendar: ICalendarService;
  readonly tasks: ITasksService;
};

export type ServicesDeps = {
  readonly client: GoogleClient;
};

export const createServices = (deps: ServicesDeps): Services => ({
  calendar: createCalendarService({ client: deps.client }),
  tasks: createTasksService({ client: deps.client }),
});
