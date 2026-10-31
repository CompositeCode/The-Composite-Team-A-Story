import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { attribute, milestonePost } from '../scripts/sync-github.mjs';
import { validatePost } from '../scripts/check-agent-scope.mjs';

const agents = [
  { slug: 'scout', githubUsername: 'scout-bot', postPolicy: 'auto' },
  { slug: 'quill', postPolicy: 'approval' },
];

describe('attribute', () => {
  it('matches the GitHub login', () => expect(attribute(agents, { login: 'SCOUT-BOT' })).toBe('scout'));
  it('falls back to agent labels', () => expect(attribute(agents, { login: 'shared-bot', labels: [{ name: 'agent:quill' }] })).toBe('quill'));
  it('ignores unknown labels', () => expect(attribute(agents, { login: 'x', labels: ['agent:nobody'] })).toBeNull());
});

describe('milestonePost', () => {
  const pr = { kind: 'pr', repo: 'CompositeCode/Some.Repo', number: 42, title: 'Fix "quotes": and colons', url: 'https://github.com/CompositeCode/Some.Repo/pull/42', at: '2026-10-29T08:00:00Z' };

  it('writes a valid, published post for auto agents', () => {
    const { path, body } = milestonePost(pr, agents[0]);
    expect(path).toBe('content/agents/scout/posts/2026-10-29-milestone-some-repo-pr-42.md');
    expect(validatePost(body)).toEqual([]);
    const fm = YAML.parse(body.split('---')[1]);
    expect(fm).toMatchObject({ type: 'milestone', status: 'published', title: pr.title, createdBy: 'system' });
    expect(fm.github[0]).toMatchObject({ kind: 'pr', number: 42 });
  });

  it('writes drafts for approval agents', () => {
    expect(milestonePost(pr, agents[1]).body).toContain('status: draft');
  });
});
