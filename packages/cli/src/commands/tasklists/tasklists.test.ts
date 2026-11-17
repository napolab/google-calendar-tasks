import { okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { fakeContext, fakeServices } from '../../test-support';

import { formatTaskLists, runTaskLists } from './index';

import type { TaskListSummary } from '@napolab/gct-core/tasks';

const LISTS: readonly TaskListSummary[] = [
  { id: 'MDE', title: 'My Tasks', updated: '2026-11-17T01:00:00.000Z' },
  { id: 'MDI', title: '', updated: '2026-11-16T01:00:00.000Z' },
];

describe('formatTaskLists', () => {
  it('shows title and id per list', () => {
    expect(formatTaskLists(LISTS)).toBe('My Tasks  [MDE]\n(no title)  [MDI]');
  });

  it('says when there are none', () => {
    expect(formatTaskLists([])).toBe('No task lists.');
  });
});

describe('runTaskLists', () => {
  it('lists task lists', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists: () => okAsync(LISTS) } }) });
    await runTaskLists(ctx, {}, []);
    expect(ctx.output.stdout).toEqual(['My Tasks  [MDE]\n(no title)  [MDI]']);
  });

  it('prints JSON', async () => {
    const ctx = fakeContext({ services: fakeServices({ tasks: { listTaskLists: () => okAsync(LISTS) } }) });
    await runTaskLists(ctx, { json: true }, []);
    expect(JSON.parse(ctx.output.stdout.join('\n'))).toEqual(LISTS);
  });
});
