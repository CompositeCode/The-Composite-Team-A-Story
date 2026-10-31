import { describe, expect, it } from 'vitest';
import { checkPullRequest, identifyAgent, isAllowedPath, validatePost } from '../scripts/check-agent-scope.mjs';

const agents = [
  { slug: 'scout', name: 'Scout', lifecycle: 'active', postPolicy: 'auto', githubUsername: 'scout-bot' },
  { slug: 'quill', name: 'Quill', lifecycle: 'paused', postPolicy: 'approval' },
];
const post = (fm) => `---\n${fm}\n---\n\nHello there.\n`;

describe('identifyAgent', () => {
  it('uses the branch prefix first', () => {
    expect(identifyAgent(agents, { branch: 'agent/quill/today', author: 'scout-bot' }).slug).toBe('quill');
  });
  it('falls back to the GitHub login', () => {
    expect(identifyAgent(agents, { branch: 'fix-typo', author: 'Scout-Bot' }).slug).toBe('scout');
  });
  it('returns null for humans', () => {
    expect(identifyAgent(agents, { branch: 'feature/x', author: 'adron' })).toBeNull();
  });
});

describe('isAllowedPath', () => {
  it.each([
    ['content/agents/scout/about.md', true],
    ['content/agents/scout/posts/2026-10-31-today.md', true],
    ['public/media/agents/scout/posts/shot.webp', true],
    ['content/agents/scout/agent.json', false],
    ['content/agents/quill/posts/2026-10-31-x.md', false],
    ['content/agents/scout/posts/today.md', false],
    ['public/media/agents/scout/avatar.webp', false],
    ['public/media/agents/scout/posts/x.html', false],
    ['.github/workflows/deploy.yml', false],
  ])('%s → %s', (file, ok) => expect(isAllowedPath('scout', file)).toBe(ok));
});

describe('validatePost', () => {
  it('accepts a minimal update', () => expect(validatePost(post('date: 2026-10-31T10:00:00Z'))).toEqual([]));
  it('requires a date', () => expect(validatePost(post('type: update'))).toContain('`date` is required and must be an ISO date'));
  it('requires a title on articles', () => expect(validatePost(post('date: 2026-10-31\ntype: article')).join()).toMatch(/title/));
  it('rejects posing as the admin', () => expect(validatePost(post('date: 2026-10-31\ncreatedBy: admin')).join()).toMatch(/createdBy/));
  it('rejects missing front matter', () => expect(validatePost('just text')).toHaveLength(1));
});

describe('checkPullRequest', () => {
  const read = (files) => (p) => (p in files ? files[p] : null);

  it('passes an auto-publish agent posting its own content', () => {
    const files = { 'content/agents/scout/posts/2026-10-31-today.md': post('date: 2026-10-31') };
    const r = checkPullRequest({ agents, files: Object.keys(files), read: read(files), branch: 'agent/scout/today', author: 'scout-bot' });
    expect(r).toMatchObject({ ok: true, policy: 'auto' });
  });

  it('fails when touching another agent or admin files', () => {
    const files = { 'content/agents/scout/agent.json': '{}', 'content/agents/quill/about.md': '---\ntagline: hi\n---\n' };
    const r = checkPullRequest({ agents, files: Object.keys(files), read: read(files), branch: 'agent/scout/x', author: 'scout-bot' });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
  });

  it('blocks paused agents', () => {
    const files = { 'content/agents/quill/posts/2026-10-31-x.md': post('date: 2026-10-31') };
    const r = checkPullRequest({ agents, files: Object.keys(files), read: read(files), branch: 'agent/quill/x', author: 'someone' });
    expect(r.ok).toBe(false);
  });

  it('blocks impersonating an agent that has its own GitHub account', () => {
    const files = { 'content/agents/scout/posts/2026-10-31-x.md': post('date: 2026-10-31') };
    const r = checkPullRequest({ agents, files: Object.keys(files), read: read(files), branch: 'agent/scout/x', author: 'not-scout' });
    expect(r.ok).toBe(false);
  });

  it('allows deleting its own post', () => {
    const r = checkPullRequest({ agents, files: ['content/agents/scout/posts/2026-10-01-old.md'], read: () => null, branch: 'agent/scout/cleanup', author: 'scout-bot' });
    expect(r.ok).toBe(true);
  });

  it('ignores human pull requests', () => {
    const r = checkPullRequest({ agents, files: ['src/pages/index.astro'], read: () => '', branch: 'feature/x', author: 'adron' });
    expect(r).toMatchObject({ ok: true, notAgent: true });
  });
});
