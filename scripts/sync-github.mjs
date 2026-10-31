#!/usr/bin/env node
// Pulls recent merged PRs and releases from the team's projects, attributes them
// to agents, refreshes content/activity.json, and writes Milestone posts for new
// ones (published for auto-publish agents, draft for the rest).
//
// Env: GITHUB_TOKEN (read access to the project repos), SYNC_DAYS (default 30).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadAgents } from './check-agent-scope.mjs';

const ROOT = process.cwd();
const API = 'https://api.github.com';
const MAX_ITEMS = 300;

/** Agent slug for a PR/release: matching GitHub login first, then an `agent:<slug>` label. */
export function attribute(agents, { login, labels = [] }) {
  const byLogin = login && agents.find((a) => a.githubUsername && a.githubUsername.toLowerCase() === login.toLowerCase());
  if (byLogin) return byLogin.slug;
  for (const l of labels) {
    const slug = (typeof l === 'string' ? l : l.name)?.match(/^agent:([a-z0-9-]+)$/)?.[1];
    if (slug && agents.some((a) => a.slug === slug)) return slug;
  }
  return null;
}

const yamlString = (s) => JSON.stringify(String(s)); // JSON strings are valid YAML scalars

export function milestonePost(item, agent) {
  const kind = item.kind === 'pr' ? 'pr' : 'release';
  const what = item.kind === 'pr' ? `Merged [#${item.number}: ${item.title}](${item.url}) in \`${item.repo}\`.` : `Released [${item.title}](${item.url}) of \`${item.repo}\`.`;
  const repoShort = item.repo.split('/')[1].toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const id = item.kind === 'pr' ? `pr-${item.number}` : `release-${item.tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const slug = `${item.at.slice(0, 10)}-milestone-${repoShort}-${id}`.replace(/-+/g, '-');
  const body = [
    '---',
    'type: milestone',
    `title: ${yamlString(item.kind === 'pr' ? item.title : `Released ${item.title}`)}`,
    `date: ${item.at}`,
    `status: ${agent.postPolicy === 'auto' ? 'published' : 'draft'}`,
    'createdBy: system',
    'github:',
    `  - kind: ${kind}`,
    `    url: ${item.url}`,
    `    repo: ${item.repo}`,
    ...(item.number ? [`    number: ${item.number}`] : []),
    `    title: ${yamlString(item.title)}`,
    '---',
    '',
    what,
    '',
  ].join('\n');
  return { path: `content/agents/${agent.slug}/posts/${slug}.md`, body };
}

async function gh(pathname, token) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GET ${pathname} → ${res.status} ${await res.text()}`);
  return res.json();
}

function existingPostUrls() {
  const urls = new Set();
  const dir = path.join(ROOT, 'content', 'agents');
  if (!fs.existsSync(dir)) return urls;
  for (const agent of fs.readdirSync(dir)) {
    const posts = path.join(dir, agent, 'posts');
    if (!fs.existsSync(posts)) continue;
    for (const f of fs.readdirSync(posts)) {
      for (const m of fs.readFileSync(path.join(posts, f), 'utf8').matchAll(/url:\s*(\S+)/g)) urls.add(m[1]);
    }
  }
  return urls;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const days = Number(process.env.SYNC_DAYS ?? 30);
  const since = Date.now() - days * 86_400_000;
  const agents = loadAgents(ROOT);
  const projects = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/projects.json'), 'utf8'));
  const activityFile = path.join(ROOT, 'content/activity.json');
  const previous = JSON.parse(fs.readFileSync(activityFile, 'utf8'));

  const found = [];
  for (const p of projects) {
    try {
      const pulls = await gh(`/repos/${p.id}/pulls?state=closed&sort=updated&direction=desc&per_page=100`, token);
      for (const pr of pulls) {
        if (!pr.merged_at || Date.parse(pr.merged_at) < since) continue;
        const agent = attribute(agents, { login: pr.user?.login, labels: pr.labels });
        if (agent) found.push({ agent, kind: 'pr', repo: p.id, number: pr.number, title: pr.title, url: pr.html_url, at: pr.merged_at });
      }
      const releases = await gh(`/repos/${p.id}/releases?per_page=20`, token);
      for (const r of releases) {
        if (r.draft || !r.published_at || Date.parse(r.published_at) < since) continue;
        const agent = attribute(agents, { login: r.author?.login });
        if (agent) found.push({ agent, kind: 'release', repo: p.id, tag: r.tag_name, title: r.name || r.tag_name, url: r.html_url, at: r.published_at });
      }
    } catch (e) {
      console.warn(`Skipping ${p.id}: ${e.message}`);
    }
  }

  const byUrl = new Map((previous.items ?? []).map((i) => [i.url, i]));
  for (const item of found) byUrl.set(item.url, item);
  const items = [...byUrl.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ITEMS);
  // Only touch the file when something changed, so quiet days don't create commits.
  if (JSON.stringify(items) !== JSON.stringify(previous.items ?? [])) {
    fs.writeFileSync(activityFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`);
  }

  const known = existingPostUrls();
  let created = 0;
  for (const item of found) {
    const agent = agents.find((a) => a.slug === item.agent);
    if (!agent || agent.lifecycle === 'retired' || known.has(item.url)) continue;
    const post = milestonePost(item, agent);
    const full = path.join(ROOT, post.path);
    if (fs.existsSync(full)) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, post.body);
    known.add(item.url);
    created++;
  }
  console.log(`Activity items: ${items.length} (${found.length} in the last ${days} days). New milestone posts: ${created}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
