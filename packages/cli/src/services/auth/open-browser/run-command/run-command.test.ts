import { describe, expect, it } from 'vitest';

import { OpenCommandError, runCommand } from './index';

describe('OpenCommandError', () => {
  it('names the command and its exit code', () => {
    const error = new OpenCommandError('xdg-open', { kind: 'exited', code: 3 });
    expect(error.name).toBe('OpenCommandError');
    expect(error.message).toContain('xdg-open');
    expect(error.message).toContain('3');
  });

  it('keeps a spawn failure on cause', () => {
    const cause = new Error('spawn wslview ENOENT');
    const error = new OpenCommandError('wslview', { kind: 'spawn-failed', cause });
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('wslview');
  });
});

describe('runCommand', () => {
  it('succeeds when the command exits 0', async () => {
    expect((await runCommand({ command: 'node', args: ['-e', ''] })).isOk()).toBe(true);
  });

  it('fails with the exit code', async () => {
    const error = (await runCommand({ command: 'node', args: ['-e', 'process.exit(3)'] }))._unsafeUnwrapErr();
    expect(error.status).toEqual({ kind: 'exited', code: 3 });
  });

  it('fails when the command does not exist', async () => {
    const error = (await runCommand({ command: 'gct-no-such-command', args: [] }))._unsafeUnwrapErr();
    expect(error.status.kind).toBe('spawn-failed');
  });
});
