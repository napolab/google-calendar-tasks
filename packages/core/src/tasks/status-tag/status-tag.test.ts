import { describe, expect, it } from 'vitest';

import { boardStatusOf, parseStatusTag, writeStatusTag } from './index';

describe('parseStatusTag', () => {
  it('reads a canonical first-line tag and returns the rest as the body', () => {
    expect(parseStatusTag('[status: doing]\nbuy milk\nand eggs')).toEqual({ kind: 'tagged', status: 'doing', body: 'buy milk\nand eggs' });
  });

  it('reads every known value', () => {
    expect(parseStatusTag('[status: todo]')).toEqual({ kind: 'tagged', status: 'todo', body: '' });
    expect(parseStatusTag('[status: doing]')).toEqual({ kind: 'tagged', status: 'doing', body: '' });
    expect(parseStatusTag('[status: done]')).toEqual({ kind: 'tagged', status: 'done', body: '' });
  });

  it('is lenient about whitespace and case', () => {
    expect(parseStatusTag('  [ Status :DOING ]  \nbody')).toEqual({ kind: 'tagged', status: 'doing', body: 'body' });
    expect(parseStatusTag('[STATUS:todo]')).toEqual({ kind: 'tagged', status: 'todo', body: '' });
  });

  it('treats a CRLF first line as the tag line and keeps the body as is', () => {
    expect(parseStatusTag('[status: doing]\r\nline 1\r\nline 2')).toEqual({ kind: 'tagged', status: 'doing', body: 'line 1\r\nline 2' });
  });

  it('reports an unrecognized value as unknown (the line is still the tag line)', () => {
    expect(parseStatusTag('[status: blocked]\nwaiting on X')).toEqual({ kind: 'unknown', value: 'blocked', body: 'waiting on X' });
    expect(parseStatusTag('[status: ]')).toEqual({ kind: 'unknown', value: '', body: '' });
  });

  it('returns the whole notes as the body when the first line is not a tag', () => {
    expect(parseStatusTag('')).toEqual({ kind: 'none', body: '' });
    expect(parseStatusTag('buy milk')).toEqual({ kind: 'none', body: 'buy milk' });
    expect(parseStatusTag('note\n[status: doing]')).toEqual({ kind: 'none', body: 'note\n[status: doing]' });
    expect(parseStatusTag('[status: doing] and more text')).toEqual({ kind: 'none', body: '[status: doing] and more text' });
    expect(parseStatusTag('[priority: high]')).toEqual({ kind: 'none', body: '[priority: high]' });
  });
});

describe('writeStatusTag', () => {
  it('inserts a canonical tag line above untagged notes', () => {
    expect(writeStatusTag('buy milk', 'doing')).toBe('[status: doing]\nbuy milk');
  });

  it('writes only the tag for empty notes', () => {
    expect(writeStatusTag('', 'todo')).toBe('[status: todo]');
  });

  it('replaces an existing tag line (known, lenient or unknown) canonically', () => {
    expect(writeStatusTag('[status: todo]\nbuy milk', 'done')).toBe('[status: done]\nbuy milk');
    expect(writeStatusTag('  [ STATUS: Doing ]\nbuy milk', 'todo')).toBe('[status: todo]\nbuy milk');
    expect(writeStatusTag('[status: blocked]\nbuy milk', 'doing')).toBe('[status: doing]\nbuy milk');
  });

  it('keeps everything after the first line byte for byte (no newline drift)', () => {
    expect(writeStatusTag('[status: todo]\n', 'doing')).toBe('[status: doing]\n');
    expect(writeStatusTag('[status: todo]\r\nline\r\n', 'doing')).toBe('[status: doing]\r\nline\r\n');
    expect(writeStatusTag('body\n\n', 'doing')).toBe('[status: doing]\nbody\n\n');
    expect(writeStatusTag('\nbody', 'doing')).toBe('[status: doing]\n\nbody');
  });

  it('is idempotent and the last write wins', () => {
    const once = writeStatusTag('buy milk', 'doing');
    expect(writeStatusTag(once, 'doing')).toBe(once);
    expect(writeStatusTag(once, 'done')).toBe(writeStatusTag('buy milk', 'done'));
  });

  it('round-trips the body through parse', () => {
    for (const notes of ['', 'a', 'a\nb', 'a\n', '\n', '[status: doing]\nx', '[status: zzz]\r\ny\r\n']) {
      const written = writeStatusTag(notes, 'doing');
      expect(parseStatusTag(written)).toEqual({ kind: 'tagged', status: 'doing', body: parseStatusTag(notes).body });
    }
  });
});

describe('boardStatusOf', () => {
  it('puts a completed task in done whatever its tag says', () => {
    expect(boardStatusOf({ status: 'completed', notes: '' })).toBe('done');
    expect(boardStatusOf({ status: 'completed', notes: '[status: doing]' })).toBe('done');
  });

  it('puts an open task tagged doing in doing', () => {
    expect(boardStatusOf({ status: 'needsAction', notes: '[status: doing]\nx' })).toBe('doing');
  });

  it('puts every other open task in todo (todo tag, no tag, unknown tag, or a stale done tag)', () => {
    expect(boardStatusOf({ status: 'needsAction', notes: '[status: todo]' })).toBe('todo');
    expect(boardStatusOf({ status: 'needsAction', notes: 'plain notes' })).toBe('todo');
    expect(boardStatusOf({ status: 'needsAction', notes: '[status: blocked]' })).toBe('todo');
    // Reopened in Google's own app: Google's status wins over the tag.
    expect(boardStatusOf({ status: 'needsAction', notes: '[status: done]' })).toBe('todo');
  });
});
