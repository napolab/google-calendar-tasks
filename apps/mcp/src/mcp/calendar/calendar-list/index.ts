import { InvalidInputError } from '@napolab/gct-core/errors';
import { Result, err, ok as okResult } from 'neverthrow';
import { z } from 'zod';

import { ok, toToolError } from '../../tool-result';
import { DESTRUCTIVE, IDEMPOTENT_UPDATE, READ_ONLY, calendarIdArg, calendarOf, setOrKeep, toTextPatch, zoneName } from '../shared';

import type { ToolDeps } from '../../tool-deps';
import type { ToolResult } from '../../tool-result';
import type {
  AccessRole,
  CalendarColor,
  CalendarListEntry,
  CalendarNotificationType,
  ListEntryColor,
  ReminderOverride,
  SetPatch,
  SubscribeCalendarInput,
  UpdateCalendarListEntryInput,
} from '@napolab/gct-core/calendar';
import type { McpServer } from '@modelcontextprotocol/server';

// Calendar list tools: which calendars the user has added to their list and how each is shown to them only
// (name override, color, hidden, default reminders, email notifications).

// ---- arguments ----

const colorShape = {
  colorId: z.string().min(1).optional().describe('Calendar color id from get_colors (calendar palette). Or pass backgroundColor + foregroundColor instead.'),
  backgroundColor: z.string().optional().describe('#RRGGBB background, together with foregroundColor (instead of colorId).'),
  foregroundColor: z.string().optional().describe('#RRGGBB text color, together with backgroundColor.'),
};

export const getCalendarListEntryArgs = z.strictObject({ calendarId: calendarIdArg });

export const subscribeCalendarArgs = z.strictObject({
  calendarId: z.string().min(1).describe('Id of an existing calendar to add, e.g. "ja.japanese#holiday@group.v.calendar.google.com" or a calendar shared with the user.'),
  ...colorShape,
});

export const updateCalendarListEntryArgs = z.strictObject({
  calendarId: calendarIdArg,
  summaryOverride: z.string().optional().describe('The name the user sees for this calendar (only for them). Omit to keep; clearSummaryOverride restores the real title.'),
  clearSummaryOverride: z.boolean().optional(),
  ...colorShape,
  hidden: z.boolean().optional().describe('true hides the calendar from the list.'),
  selected: z.boolean().optional().describe('true shows its events in the calendar UI.'),
  defaultReminders: z
    .array(z.strictObject({ method: z.enum(['email', 'popup']), minutes: z.number().int().min(0).max(40320) }))
    .max(5)
    .optional()
    .describe('Replaces the default reminders of new events on this calendar; [] = none.'),
  notifications: z
    .array(z.enum(['eventCreation', 'eventChange', 'eventCancellation', 'eventResponse', 'agenda']))
    .optional()
    .describe('Replaces which emails the user gets for this calendar; [] = none.'),
});

export const unsubscribeCalendarArgs = z.strictObject({ calendarId: z.string().min(1).describe("Id of the calendar to remove from the user's list. 'primary' cannot be removed.") });

export type GetCalendarListEntryArgs = z.output<typeof getCalendarListEntryArgs>;
export type SubscribeCalendarArgs = z.output<typeof subscribeCalendarArgs>;
export type UpdateCalendarListEntryArgs = z.output<typeof updateCalendarListEntryArgs>;
export type UnsubscribeCalendarArgs = z.output<typeof unsubscribeCalendarArgs>;

type ColorArgs = { readonly colorId?: string | undefined; readonly backgroundColor?: string | undefined; readonly foregroundColor?: string | undefined };

// ---- mapping ----

// colorId, or both RGB colors, or nothing.
const toColor = (args: ColorArgs): Result<ListEntryColor | undefined, InvalidInputError> => {
  const rgbGiven = args.backgroundColor !== undefined || args.foregroundColor !== undefined;
  if (args.colorId !== undefined && rgbGiven) return err(new InvalidInputError('Pass either colorId or backgroundColor + foregroundColor, not both.'));
  if (args.colorId !== undefined) return okResult({ kind: 'palette', colorId: args.colorId });
  if (!rgbGiven) return okResult(undefined);
  if (args.backgroundColor === undefined || args.foregroundColor === undefined)
    return err(new InvalidInputError('backgroundColor and foregroundColor go together: pass both as #RRGGBB (e.g. "#0088aa" and "#ffffff"), or use colorId instead.'));
  return okResult({ kind: 'rgb', background: args.backgroundColor, foreground: args.foregroundColor });
};

export const toSubscribeCalendarInput = (args: SubscribeCalendarArgs): Result<SubscribeCalendarInput, InvalidInputError> =>
  toColor(args).map((color) => ({ calendarId: args.calendarId, color: color ?? { kind: 'default' } }));

const requireChange = (input: UpdateCalendarListEntryInput): Result<UpdateCalendarListEntryInput, InvalidInputError> => {
  if ([input.summaryOverride, input.color, input.hidden, input.selected, input.defaultReminders, input.notifications].some((patch) => patch.kind !== 'keep')) return okResult(input);
  return err(
    new InvalidInputError(
      'Nothing to update: pass at least one of summaryOverride / clearSummaryOverride, colorId or backgroundColor + foregroundColor, hidden, selected, defaultReminders, notifications.',
    ),
  );
};

export const toUpdateCalendarListEntryInput = (args: UpdateCalendarListEntryArgs): Result<UpdateCalendarListEntryInput, InvalidInputError> =>
  toTextPatch({ field: 'summaryOverride', clearArg: 'clearSummaryOverride', value: args.summaryOverride, clear: args.clearSummaryOverride }).andThen((summaryOverride) =>
    toColor(args)
      .map((color): UpdateCalendarListEntryInput => ({
        ...calendarOf(args.calendarId),
        summaryOverride,
        color: setOrKeep(color) satisfies SetPatch<ListEntryColor>,
        hidden: setOrKeep(args.hidden),
        selected: setOrKeep(args.selected),
        defaultReminders: setOrKeep<readonly ReminderOverride[]>(args.defaultReminders),
        notifications: setOrKeep<readonly CalendarNotificationType[]>(args.notifications),
      }))
      .andThen(requireChange),
  );

// ---- view ----

export type CalendarListEntryView = {
  readonly id: string;
  readonly summary: string;
  // null = not overridden / not set.
  readonly summaryOverride: string | null;
  readonly description: string | null;
  readonly location: string | null;
  readonly timeZone: string | null;
  readonly accessRole: AccessRole;
  readonly primary: boolean;
  readonly hidden: boolean;
  readonly selected: boolean;
  readonly colorId: string | null;
  readonly backgroundColor: string | null;
  readonly foregroundColor: string | null;
  readonly defaultReminders: readonly ReminderOverride[];
  readonly notifications: readonly CalendarNotificationType[];
};

const textOrNull = (value: string): string | null => (value === '' ? null : value);

const hexOf = (color: CalendarColor): string | null => {
  switch (color.kind) {
    case 'none':
      return null;
    case 'hex':
      return color.hex;
    default: {
      const _exhaustive: never = color;
      throw new Error(`unhandled color: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

export const toCalendarListEntryView = (entry: CalendarListEntry): CalendarListEntryView => ({
  id: entry.id,
  summary: entry.summary,
  summaryOverride: textOrNull(entry.summaryOverride),
  description: textOrNull(entry.description),
  location: textOrNull(entry.location),
  timeZone: zoneName(entry.timeZone),
  accessRole: entry.accessRole,
  primary: entry.primary,
  hidden: entry.hidden,
  selected: entry.selected,
  colorId: textOrNull(entry.colorId),
  backgroundColor: hexOf(entry.backgroundColor),
  foregroundColor: hexOf(entry.foregroundColor),
  defaultReminders: entry.defaultReminders,
  notifications: entry.notifications,
});

// ---- tools ----

export const createCalendarListToolHandlers = (deps: ToolDeps) => {
  const { calendar } = deps.services;
  const fail = toToolError(deps.connectURL, 'calendarList');

  return {
    getCalendarListEntry: (args: GetCalendarListEntryArgs): Promise<ToolResult> => calendar.getCalendarListEntry(calendarOf(args.calendarId)).map(toCalendarListEntryView).match(ok, fail),

    subscribeCalendar: (args: SubscribeCalendarArgs): Promise<ToolResult> =>
      toSubscribeCalendarInput(args)
        .asyncAndThen((input) => calendar.subscribeCalendar(input))
        .map(toCalendarListEntryView)
        .match(ok, fail),

    updateCalendarListEntry: (args: UpdateCalendarListEntryArgs): Promise<ToolResult> =>
      toUpdateCalendarListEntryInput(args)
        .asyncAndThen((input) => calendar.updateCalendarListEntry(input))
        .map(toCalendarListEntryView)
        .match(ok, fail),

    unsubscribeCalendar: (args: UnsubscribeCalendarArgs): Promise<ToolResult> =>
      calendar
        .unsubscribeCalendar({ calendarId: args.calendarId })
        .map(() => ({ unsubscribed: true, calendarId: args.calendarId }))
        .match(ok, fail),
  };
};

export const registerCalendarListTools = (server: McpServer, deps: ToolDeps): void => {
  const handlers = createCalendarListToolHandlers(deps);

  server.registerTool(
    'get_calendar_list_entry',
    {
      title: 'Get calendar list entry',
      description: "How one calendar appears in the user's list: name override, color, hidden / selected, default reminders, email notifications, access role.",
      inputSchema: getCalendarListEntryArgs,
      annotations: READ_ONLY,
    },
    handlers.getCalendarListEntry,
  );

  server.registerTool(
    'subscribe_calendar',
    {
      title: 'Subscribe to calendar',
      description:
        "Add an existing calendar (public, e.g. a holiday calendar, or one shared with the user) to the user's calendar list, optionally with a color. Use create_calendar to make a new one.",
      inputSchema: subscribeCalendarArgs,
      annotations: IDEMPOTENT_UPDATE,
    },
    handlers.subscribeCalendar,
  );

  server.registerTool(
    'update_calendar_list_entry',
    {
      title: 'Update calendar list entry',
      description:
        'Change how a calendar appears to this user only: summaryOverride, colorId or backgroundColor + foregroundColor (#RRGGBB), hidden, selected, defaultReminders, notifications. Omitted fields are kept.',
      inputSchema: updateCalendarListEntryArgs,
      annotations: IDEMPOTENT_UPDATE,
    },
    handlers.updateCalendarListEntry,
  );

  server.registerTool(
    'unsubscribe_calendar',
    {
      title: 'Unsubscribe from calendar',
      description: "Remove a calendar from the user's list (the calendar and its events stay; subscribe_calendar adds it back if it is still shared). 'primary' cannot be removed.",
      inputSchema: unsubscribeCalendarArgs,
      annotations: DESTRUCTIVE,
    },
    handlers.unsubscribeCalendar,
  );
};
