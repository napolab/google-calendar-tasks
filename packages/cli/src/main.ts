#!/usr/bin/env node
import { homedir } from 'node:os';

import { dayjs } from '@napolab/gct-core/dayjs';
import { createCalendarService } from '@napolab/gct-core/calendar';
import { createGoogleClient } from '@napolab/gct-core/google-client';
import { ALL_SCOPES } from '@napolab/gct-core/scopes';
import { createTasksService } from '@napolab/gct-core/tasks';
import { cli, define } from 'gunshi';
import { ResultAsync } from 'neverthrow';

import packageJSON from '../package.json' with { type: 'json' };

import { createCalendarsCommand } from './commands/calendars';
import { createEventsCommand } from './commands/events';
import { createFreeBusyCommand } from './commands/freebusy';
import { createLoginCommand } from './commands/login';
import { createLogoutCommand } from './commands/logout';
import { formatUsageFailure, reportMissingSubcommand } from './commands/shared/output';
import { createStatusCommand } from './commands/status';
import { createTaskListsCommand } from './commands/tasklists';
import { createTasksCommand } from './commands/tasks';
import { createAuthService, createLoginState } from './services/auth';
import { startLoopbackServer } from './services/auth/loopback-server';
import { openInBrowser } from './services/auth/open-browser';
import { loadConfig } from './services/config';
import { createCredentialStore, resolveCredentialDir } from './services/credential-store';

import type { CliContext, Output } from './context';
import type { Fetch } from '@napolab/gct-core/google-client';
import type { Now } from '@napolab/gct-core/oauth';
import type { Services } from '@napolab/gct-core/services';

// The process entrypoint and the only module that sees both layers (.claude/rules/entrypoint-lifetime.md):
// it creates the long-lived resources once — output channels, fetch, the clock, the OAuth client config, the
// credential store and the loopback-server factory — builds the services on them, and injects the resulting
// CliContext into the commands. A login's loopback server and deadline are owned by the login command.

const output: Output = {
  out: (text) => {
    process.stdout.write(`${text}\n`);
  },
  err: (text) => {
    process.stderr.write(`${text}\n`);
  },
  fail: () => {
    process.exitCode = 1;
  },
};

const fetch: Fetch = (input, init) => globalThis.fetch(input, init);
const clock: Now = () => dayjs().valueOf();
const config = loadConfig(process.env);
const store = createCredentialStore({ dir: resolveCredentialDir(process.env, homedir()) });

const auth = createAuthService({
  config,
  store,
  fetch,
  now: clock,
  scopes: ALL_SCOPES,
  createState: createLoginState,
  openBrowser: openInBrowser,
  startLoopback: startLoopbackServer,
});

// Core's Google services on the stored login, built only when a command needs them (after its input is valid).
const services: CliContext['services'] = () =>
  auth.getAccessToken().map((getAccessToken): Services => {
    const client = createGoogleClient({ fetch, getAccessToken });
    return { calendar: createCalendarService({ client }), tasks: createTasksService({ client }) };
  });

const context: CliContext = { output, clock, auth, services };

const subCommands = {
  login: createLoginCommand(context),
  logout: createLogoutCommand(context),
  status: createStatusCommand(context),
  calendars: createCalendarsCommand(context),
  events: createEventsCommand(context),
  freebusy: createFreeBusyCommand(context),
  tasklists: createTaskListsCommand(context),
  tasks: createTasksCommand(context),
};

const root = define({
  name: 'gct',
  description: 'Google Calendar and Google Tasks from the command line',
  run: () => reportMissingSubcommand(output, 'gct', Object.keys(subCommands)),
});

// gunshi renders help itself and throws for bad usage (unknown command / option, wrong type, missing argument).
// Its validation output is turned off here and printed to stderr instead, so stdout only ever carries results.
await ResultAsync.fromPromise(
  cli(process.argv.slice(2), root, { name: 'gct', version: packageJSON.version, description: root.description, subCommands, strict: true, renderHeader: null, renderValidationErrors: null }),
  (error) => error,
).match(
  () => undefined,
  (error) => {
    output.err(formatUsageFailure(error));
    output.fail();
  },
);
