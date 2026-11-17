import type { ICalendarService } from '../calendar';
import type { ITasksService } from '../tasks';

// The services map injected into every edge (CLI commands, Hono `Variables.services` in apps/mcp).
// Type only — each entrypoint lists the concrete factories itself (createCalendarService / createTasksService),
// so the wiring stays visible where the lifetimes are owned (.claude/rules/entrypoint-lifetime.md).
// Mirrors Genovese / request-invite-system `shared/callable` `Services` (.claude/rules/shared.md).
export type Services = {
  readonly calendar: ICalendarService;
  readonly tasks: ITasksService;
};
