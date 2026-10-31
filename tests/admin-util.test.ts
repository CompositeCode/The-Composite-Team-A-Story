import { describe, expect, it } from 'vitest';
import { hashPassword as nodeHash } from '../scripts/hash-password.mjs';
import { hashPassword, parseMd, parseRefs, slugify, stringifyMd, verifyPassword } from '../src/admin/util';

describe('passwords', () => {
  it('verifies hashes made by the CLI script', async () => {
    const hash = nodeHash('correct horse battery staple', undefined, 1000);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
  it('round-trips browser hashes', async () => {
    const hash = await hashPassword('another long password', 1000);
    expect(await verifyPassword('another long password', hash)).toBe(true);
  });
  it('rejects malformed hashes', async () => expect(await verifyPassword('x', 'plain')).toBe(false));
});

describe('front matter', () => {
  it('round-trips and drops empty values', () => {
    const md = stringifyMd({ type: 'update', title: '', tags: [], date: '2026-10-31T10:00:00Z', github: [{ kind: 'repo', url: 'https://github.com/a/b' }] }, '\nHello **world**\n');
    expect(md).not.toMatch(/title|tags/);
    const { data, body } = parseMd(md);
    expect(data).toMatchObject({ type: 'update', date: '2026-10-31T10:00:00Z' });
    expect(body.trim()).toBe('Hello **world**');
  });
});

describe('parseRefs', () => {
  it('classifies GitHub URLs', () => {
    const refs = parseRefs('https://github.com/a/b/pull/3\nhttps://github.com/a/b/issues/9 https://github.com/a/b https://example.com');
    expect(refs.map((r) => [r.kind, r.number])).toEqual([['pr', 3], ['issue', 9], ['repo', undefined]]);
  });
});

describe('slugify', () => {
  it('makes URL-safe slugs', () => expect(slugify('Héllo, World! Ship it')).toBe('hello-world-ship-it'));
});
