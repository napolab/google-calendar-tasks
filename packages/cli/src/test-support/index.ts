import { GoogleAPIError } from '@napolab/gct-core/errors';
import { errAsync, okAsync } from 'neverthrow';

import { LoopbackServerError, NotLoggedInError } from '../context/errors';

import type { CliContext, IAuthService, Output } from '../context';
import type { ICalendarService } from '@napolab/gct-core/calendar';
import type { Services } from '@napolab/gct-core/services';
import type { ITasksService } from '@napolab/gct-core/tasks';
import type { ResultAsync } from 'neverthrow';

// Test doubles for CliContext members. Never imported by production code.

export type FakeOutput = Output & { readonly stdout: string[]; readonly stderr: string[]; readonly failed: () => boolean };

export const createFakeOutput = (): FakeOutput => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const state = { failed: false };
  return {
    stdout,
    stderr,
    failed: () => state.failed,
    out: (text) => {
      stdout.push(text);
    },
    err: (text) => {
      stderr.push(text);
    },
    fail: () => {
      state.failed = true;
    },
  };
};

const unexpected = (): ResultAsync<never, GoogleAPIError> => errAsync(new GoogleAPIError('unexpected call in test', 500));

const unusedCalendar: ICalendarService = {
  listCalendars: unexpected,
  listEvents: unexpected,
  getEvent: unexpected,
  createEvent: unexpected,
  updateEvent: unexpected,
  deleteEvent: unexpected,
  queryFreeBusy: unexpected,
};

const unusedTasks: ITasksService = {
  listTaskLists: unexpected,
  listTasks: unexpected,
  getTask: unexpected,
  createTask: unexpected,
  updateTask: unexpected,
  completeTask: unexpected,
  reopenTask: unexpected,
  deleteTask: unexpected,
};

// Every method not overridden fails the call, so a test notices an unexpected request.
export const fakeServices = (overrides: { readonly calendar?: Partial<ICalendarService>; readonly tasks?: Partial<ITasksService> }): Services => ({
  calendar: { ...unusedCalendar, ...overrides.calendar },
  tasks: { ...unusedTasks, ...overrides.tasks },
});

const notLoggedIn = () => errAsync(new NotLoggedInError('Not logged in to Google yet.'));

export const FAKE_CREDENTIAL_PATH = '/home/me/.config/gct/credentials.json';

// A logged-out auth service; override the members a test needs.
export const fakeAuth = (overrides: Partial<IAuthService>): IAuthService => ({
  credentialPath: FAKE_CREDENTIAL_PATH,
  startLogin: () => errAsync(new LoopbackServerError('startLogin not expected in this test')),
  logout: () => okAsync({ kind: 'not-logged-in' }),
  status: () => okAsync({ kind: 'logged-out', credentialPath: FAKE_CREDENTIAL_PATH }),
  getAccessToken: notLoggedIn,
  ...overrides,
});

// 2026-11-17 10:00 in Asia/Tokyo.
export const FAKE_NOW = Date.UTC(2026, 10, 17, 1, 0, 0);

// A CliContext whose output is captured and clock is fixed. `services` (the value Google calls go to) makes
// `context.services()` succeed; without it every Google call fails as not logged in.
export const fakeContext = (overrides: { readonly services?: Services; readonly auth?: IAuthService; readonly clock?: CliContext['clock'] } = {}): CliContext & { readonly output: FakeOutput } => {
  const { services } = overrides;
  return {
    output: createFakeOutput(),
    clock: overrides.clock ?? (() => FAKE_NOW),
    auth: overrides.auth ?? fakeAuth({}),
    services: services === undefined ? notLoggedIn : () => okAsync(services),
  };
};
