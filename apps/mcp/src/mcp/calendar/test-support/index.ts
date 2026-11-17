import { expect } from 'vitest';

import type { ToolDeps } from '../../tool-deps';
import type { ToolResult } from '../../tool-result';
import type { ICalendarService } from '@napolab/gct-core/calendar';
import type { ITasksService } from '@napolab/gct-core/tasks';

// Test helpers for the calendar tool modules: ToolDeps whose services throw on any call the test did not stub.

export const NOW: number = Date.UTC(2026, 10, 17, 3, 0, 0);

export const CONNECT_URL = 'https://gct.example.com/google/connect';

const unexpected = (): never => {
  throw new Error('unexpected call');
};

const unusedCalendar: ICalendarService = {
  listCalendars: unexpected,
  listEvents: unexpected,
  listEventInstances: unexpected,
  getEvent: unexpected,
  createEvent: unexpected,
  updateEvent: unexpected,
  deleteEvent: unexpected,
  moveEvent: unexpected,
  quickAddEvent: unexpected,
  importEvent: unexpected,
  queryFreeBusy: unexpected,
  getCalendar: unexpected,
  createCalendar: unexpected,
  updateCalendar: unexpected,
  deleteCalendar: unexpected,
  clearPrimaryCalendar: unexpected,
  getCalendarListEntry: unexpected,
  subscribeCalendar: unexpected,
  updateCalendarListEntry: unexpected,
  unsubscribeCalendar: unexpected,
  listCalendarAcl: unexpected,
  getCalendarAclRule: unexpected,
  insertCalendarAclRule: unexpected,
  updateCalendarAclRule: unexpected,
  deleteCalendarAclRule: unexpected,
  getColors: unexpected,
  listSettings: unexpected,
  getSetting: unexpected,
};

const unusedTasks: ITasksService = {
  listTaskLists: unexpected,
  getTaskList: unexpected,
  createTaskList: unexpected,
  renameTaskList: unexpected,
  deleteTaskList: unexpected,
  listTasks: unexpected,
  getTask: unexpected,
  createTask: unexpected,
  updateTask: unexpected,
  completeTask: unexpected,
  reopenTask: unexpected,
  deleteTask: unexpected,
  moveTask: unexpected,
  clearCompletedTasks: unexpected,
};

export const depsWith = (calendar: Partial<ICalendarService>): ToolDeps => ({
  services: { calendar: { ...unusedCalendar, ...calendar }, tasks: unusedTasks },
  now: () => NOW,
  connectURL: CONNECT_URL,
  defaultTaskList: '日常タスク',
});

export const jsonOf = (result: ToolResult): unknown => {
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? '');
};

export const errorTextOf = (result: ToolResult): string => {
  expect(result.isError).toBe(true);
  return result.content[0]?.text ?? '';
};

// Records every input a stubbed service method receives.
export const recorder = <I, R>(respond: (input: I) => R): { readonly calls: I[]; readonly fn: (input: I) => R } => {
  const calls: I[] = [];
  return {
    calls,
    fn: (input) => {
      calls.push(input);
      return respond(input);
    },
  };
};
