import { dayjs } from '@napolab/gct-core/dayjs';

// The `instructions` the server sends in its initialize result: the defaults every chat with this server follows.
// Built from the values the tools actually use (ToolDeps.defaultTaskList, TOOL_TIME_ZONE) so the text cannot drift
// from the behavior. Every snake_case word in it must be a registered tool (asserted in the test).

export type ServerInstructionsInput = {
  // The task list single-task tools use when `list` is omitted (a title or an id).
  readonly defaultTaskList: string;
  // The zone date-only tool arguments are read in.
  readonly timeZone: string;
};

// A fixed instant shown in the zone, e.g. 2026-11-17T10:00:00+09:00 for Asia/Tokyo.
const dateTimeExample = (timeZone: string): string => dayjs.tz('2026-11-17 10:00', timeZone).format();

export const buildServerInstructions = (input: ServerInstructionsInput): string =>
  [
    'Defaults for every conversation with this server:',
    `- Time zone: interpret and present every event and task time in ${input.timeZone}. Pass date-times as RFC 3339 with an explicit offset (e.g. ${dateTimeExample(input.timeZone)}) or a YYYY-MM-DD day (read in ${input.timeZone}).`,
    '- Guest notifications: never set sendUpdates (guests are not emailed when it is unset) unless the user explicitly asks to notify the attendees.',
    `- Task list: when the user does not name a task list, use "${input.defaultTaskList}" — omitting list on the task tools does this. For a task found with list_tasks, pass the taskListId it was listed under. list_tasks and show_task_board without list cover EVERY list. '@default' is Google's own default list, not "${input.defaultTaskList}".`,
  ].join('\n');
