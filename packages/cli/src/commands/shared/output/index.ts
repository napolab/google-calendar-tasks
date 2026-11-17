import type { Output } from '../../../context';
import type { AuthorizationDeniedError, ConfigError, CredentialStoreError, InvalidCallbackError, LoginTimeoutError, LoopbackServerError, NotLoggedInError } from '../../../context/errors';
import type { AmbiguousTaskListError, GoogleError, InvalidInputError, TaskListNotFoundError } from '@napolab/gct-core/errors';
import type { ResultAsync } from 'neverthrow';

// Every failure a command can end with.
export type CommandError =
  | GoogleError
  | InvalidInputError
  | TaskListNotFoundError
  | AmbiguousTaskListError
  | ConfigError
  | CredentialStoreError
  | NotLoggedInError
  | LoopbackServerError
  | LoginTimeoutError
  | AuthorizationDeniedError
  | InvalidCallbackError;

const LOGIN_AGAIN = 'Run `gct login` again to renew your Google credentials.';

// A next step printed under the error when the message alone does not say what to run.
const HINTS = {
  NotLoggedInError: 'Run `gct login` to sign in to Google.',
  GoogleAuthError: LOGIN_AGAIN,
  GooglePermissionError: 'If a scope is missing, run `gct login` again and approve every requested permission.',
  GoogleNotFoundError: '',
  GoogleRateLimitError: 'Wait a moment and retry.',
  GoogleAPIError: '',
  GoogleNetworkError: 'Check your network connection and retry.',
  GoogleResponseParseError: '',
  InvalidInputError: '',
  TaskListNotFoundError: 'Run `gct tasklists` to see every task list with its id.',
  AmbiguousTaskListError: '',
  ConfigError: '',
  CredentialStoreError: '',
  LoopbackServerError: '',
  LoginTimeoutError: '',
  AuthorizationDeniedError: '',
  InvalidCallbackError: '',
} satisfies Record<CommandError['name'], string>;

export const formatError = (error: CommandError): string => {
  const line = `${error.name}: ${error.message}`;
  const hint = HINTS[error.name];
  return hint === '' ? line : `${line}\n${hint}`;
};

// gunshi rejects bad usage (unknown command / option, wrong type, missing argument) by throwing an
// AggregateError of validation errors; anything else thrown here is a bug and is shown as-is.
export const formatUsageFailure = (error: unknown): string => {
  if (error instanceof AggregateError) return [...error.errors.map((inner: unknown) => (inner instanceof Error ? inner.message : `${inner}`)), 'Run the command with --help for usage.'].join('\n');
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return `${error}`;
};

export const toJSONText = (value: unknown): string => JSON.stringify(value, null, 2);

// `--json` prints the core result as JSON; otherwise the human-readable renderer.
export const renderWith =
  <T>(json: boolean | undefined, text: (value: T) => string) =>
  (value: T): string =>
    json === true ? toJSONText(value) : text(value);

// Labels a renderer's output, e.g. `Created: <event line>`.
export const prefixed =
  <T>(prefix: string, format: (value: T) => string) =>
  (value: T): string =>
    `${prefix}${format(value)}`;

// The command edge: the only place a command's Result is folded into output and the exit code.
export const report = <T>(io: Output, result: ResultAsync<T, CommandError>, render: (value: T) => string): Promise<void> =>
  result.match(
    (value) => io.out(render(value)),
    (error) => {
      io.err(formatError(error));
      io.fail();
    },
  );

// A command group (`gct`, `gct events`) run without a sub-command.
export const reportMissingSubcommand = (io: Output, command: string, subcommands: readonly string[]): void => {
  io.err(`Usage: ${command} <${subcommands.join('|')}> [options]\nRun \`${command} --help\` for details.`);
  io.fail();
};
