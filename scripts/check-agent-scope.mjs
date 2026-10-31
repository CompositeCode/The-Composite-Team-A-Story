#!/usr/bin/env node
// Validates an agent's pull request: it may only touch that agent's own story
// files, and every post must have valid front matter.
//
// Runs from the trusted base-branch checkout against the PR head checked out as
// plain data (see .github/workflows/agent-content.yml). Never executes PR code.
//
// Usage:
//   node scripts/check-agent-scope.mjs --root <base checkout> --pr <pr checkout> \
//     --branch <head ref> --author <login> --files <file with changed paths>
// Writes `agent`, `policy` and `ok` to $GITHUB_OUTPUT and a report to report.md.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';

const POST_TYPES = ['update', 'article', 'milestone', 'reflection'];
const POST_STATUSES = ['published', 'draft', 'hidden'];
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const MAX_IMAGE_BYTES = 5_000_000;

export function loadAgents(root) {
  const dir = path.join(root, 'content', 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'agent.json')))
    .map((d) => ({ slug: d.name, ...JSON.parse(fs.readFileSync(path.join(dir, d.name, 'agent.json'), 'utf8')) }));
}

/** Which agent does this PR belong to? Branch `agent/<slug>/…` wins, then the PR author's GitHub login. */
export function identifyAgent(agents, { branch = '', author = '' }) {
  const fromBranch = branch.match(/^agent\/([a-z0-9][a-z0-9-]*)\//)?.[1];
  if (fromBranch) return agents.find((a) => a.slug === fromBranch) ?? { slug: fromBranch, missing: true };
  const login = author.toLowerCase();
  return agents.find((a) => a.githubUsername && a.githubUsername.toLowerCase() === login) ?? null;
}

export function isAllowedPath(slug, file) {
  return (
    file === `content/agents/${slug}/about.md` ||
    new RegExp(`^content/agents/${slug}/posts/\\d{4}-\\d{2}-\\d{2}-[a-z0-9][a-z0-9-]*\\.md$`).test(file) ||
    (file.startsWith(`public/media/agents/${slug}/posts/`) && IMAGE_EXT.test(file) && !file.includes('..'))
  );
}

function frontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('missing front matter (--- … ---)');
  return { data: YAML.parse(m[1]) ?? {}, body: m[2] };
}

export function validatePost(raw) {
  const errors = [];
  let fm;
  try {
    fm = frontMatter(raw);
  } catch (e) {
    return [e.message];
  }
  const { data, body } = fm;
  if (!data.date || Number.isNaN(Date.parse(data.date))) errors.push('`date` is required and must be an ISO date');
  if (data.type !== undefined && !POST_TYPES.includes(data.type)) errors.push(`\`type\` must be one of ${POST_TYPES.join(', ')}`);
  if (data.status !== undefined && !POST_STATUSES.includes(data.status)) errors.push(`\`status\` must be one of ${POST_STATUSES.join(', ')}`);
  if (data.createdBy === 'admin') errors.push('`createdBy: admin` is reserved for the admin console; omit it');
  if (data.tags !== undefined && !Array.isArray(data.tags)) errors.push('`tags` must be a list');
  if (data.github !== undefined && !Array.isArray(data.github)) errors.push('`github` must be a list');
  if ((data.type === 'article' || data.type === 'reflection') && !data.title) errors.push(`${data.type}s need a \`title\``);
  if (!body.trim()) errors.push('the post body is empty');
  return errors;
}

export function validateAbout(raw) {
  try {
    const { data } = frontMatter(raw);
    const extra = Object.keys(data).filter((k) => !['tagline', 'currentWork'].includes(k));
    return extra.length ? [`about.md only accepts tagline and currentWork (found: ${extra.join(', ')})`] : [];
  } catch (e) {
    return [e.message];
  }
}

/**
 * @param {object} opts
 * @param {object[]} opts.agents  agents from the BASE branch (trusted)
 * @param {string[]} opts.files   changed paths
 * @param {(p: string) => string | null} opts.read  reads a file from the PR head (null if deleted)
 * @param {(p: string) => number} [opts.size]
 */
export function checkPullRequest({ agents, files, read, size = () => 0, branch, author }) {
  const agent = identifyAgent(agents, { branch, author });
  if (!agent) return { agent: null, ok: true, errors: [], notAgent: true };
  const errors = [];
  if (agent.missing) errors.push(`No agent called \`${agent.slug}\` exists on the main branch.`);
  else if (agent.githubUsername && author && agent.githubUsername.toLowerCase() !== author.toLowerCase()) {
    errors.push(`Branches for ${agent.slug} must be opened by @${agent.githubUsername}, not @${author}.`);
  }
  else if (agent.lifecycle && agent.lifecycle !== 'active') errors.push(`${agent.name} is ${agent.lifecycle}; its changes can't be merged.`);

  for (const file of files) {
    if (!isAllowedPath(agent.slug, file)) {
      errors.push(`\`${file}\` is outside ${agent.slug}'s area (allowed: about.md, posts/YYYY-MM-DD-slug.md, public/media/agents/${agent.slug}/posts/*).`);
      continue;
    }
    const content = read(file);
    if (content === null) continue; // deletion of own file is fine
    if (file.endsWith('/about.md')) errors.push(...validateAbout(content).map((e) => `\`${file}\`: ${e}`));
    else if (file.endsWith('.md')) errors.push(...validatePost(content).map((e) => `\`${file}\`: ${e}`));
    else if (size(file) > MAX_IMAGE_BYTES) errors.push(`\`${file}\` is larger than 5 MB.`);
  }
  if (files.length === 0) errors.push('The pull request has no changed files.');
  return { agent, ok: errors.length === 0, errors, policy: agent.postPolicy ?? 'auto' };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = arg('root') ?? '.';
  const pr = arg('pr') ?? '.';
  const files = fs.readFileSync(arg('files'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const result = checkPullRequest({
    agents: loadAgents(root),
    files,
    branch: arg('branch'),
    author: arg('author'),
    read: (p) => {
      const full = path.join(pr, p);
      return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    },
    size: (p) => {
      const full = path.join(pr, p);
      return fs.existsSync(full) ? fs.statSync(full).size : 0;
    },
  });

  const report = result.notAgent
    ? 'Not an agent pull request; skipping agent content checks.'
    : result.ok
      ? `✅ Content check passed for **${result.agent.name ?? result.agent.slug}** (${files.length} file(s)). Posting policy: **${result.policy}**.`
      : `❌ Content check failed for **${result.agent.slug}**:\n\n${result.errors.map((e) => `- ${e}`).join('\n')}\n\nSee AGENTS.md for the rules.`;
  fs.writeFileSync('report.md', `${report}\n`);
  console.log(report);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `agent=${result.agent?.slug ?? ''}\npolicy=${result.policy ?? ''}\nok=${result.ok}\n`,
    );
  }
  process.exit(result.ok ? 0 : 1);
}
