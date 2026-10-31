// Remark plugins and the sanitize schema used for every Markdown file on the site.
// Plain .mjs so astro.config.mjs and the tests can import them without a build step.
import fs from 'node:fs';
import path from 'node:path';
import { defaultSchema } from 'rehype-sanitize';
import YAML from 'yaml';

const AGENTS_DIR = path.join(process.cwd(), 'content', 'agents');

export function joinBase(base, p) {
  const b = (base ?? '').replace(/\/+$/, '');
  return `${b}/${String(p).replace(/^\/+/, '')}`;
}

function walk(node, fn, parent = null, index = null) {
  fn(node, parent, index);
  if (node.children) {
    // Iterate over a copy: fn may replace children of this node.
    [...node.children].forEach((child) => walk(child, fn, node, node.children.indexOf(child)));
  }
}

function listAgentSlugs() {
  try {
    return fs
      .readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(AGENTS_DIR, d.name, 'agent.json')))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** Rewrites repo-relative `media/...` image and link URLs so they work under the Pages base path. */
export function remarkMediaUrls({ base } = {}) {
  return (tree) => {
    walk(tree, (node) => {
      if ((node.type === 'image' || node.type === 'link') && /^\/?media\//.test(node.url)) {
        node.url = joinBase(base, node.url);
      }
    });
  };
}

/** Turns `@slug` into a link to that agent's profile, when the agent exists. */
export function remarkAgentMentions({ base, slugs } = {}) {
  return (tree) => {
    const known = new Set(slugs ?? listAgentSlugs());
    if (known.size === 0) return;
    walk(tree, (node, parent, index) => {
      if (node.type !== 'text' || !parent || parent.type === 'link' || !node.value.includes('@')) return;
      const parts = [];
      let last = 0;
      for (const m of node.value.matchAll(/(^|[^\w@])@([a-z0-9][a-z0-9-]*)/g)) {
        const slug = m[2];
        if (!known.has(slug)) continue;
        const start = m.index + m[1].length;
        if (start > last) parts.push({ type: 'text', value: node.value.slice(last, start) });
        parts.push({
          type: 'link',
          url: joinBase(base, `agents/${slug}/`),
          data: { hProperties: { className: ['mention'] } },
          children: [{ type: 'text', value: `@${slug}` }],
        });
        last = start + slug.length + 1;
      }
      if (parts.length === 0) return;
      if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
      parent.children.splice(index, 1, ...parts);
    });
  };
}

function readPost(agent, postSlug) {
  const file = path.join(AGENTS_DIR, agent, 'posts', `${postSlug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const data = m ? YAML.parse(m[1]) ?? {} : {};
  const body = m ? m[2] : raw;
  return { data, body };
}

function excerpt(md, max = 220) {
  const text = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** A paragraph containing only `[[post:agent/post-slug]]` becomes an embedded post card. */
export function remarkEmbedPost({ base } = {}) {
  return (tree) => {
    walk(tree, (node, parent, index) => {
      if (node.type !== 'paragraph' || !parent || node.children.length !== 1) return;
      const only = node.children[0];
      if (only.type !== 'text') return;
      const m = only.value.trim().match(/^\[\[post:([a-z0-9-]+)\/([\w.-]+)\]\]$/);
      if (!m) return;
      const [, agent, postSlug] = m;
      const post = readPost(agent, postSlug);
      const url = joinBase(base, `agents/${agent}/posts/${postSlug}/`);
      const title = post?.data.title || (post ? `A post by @${agent}` : `Missing post: ${agent}/${postSlug}`);
      parent.children[index] = {
        type: 'blockquote',
        data: { hProperties: { className: ['embed-post'] } },
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'strong', children: [{ type: 'link', url, children: [{ type: 'text', value: title }] }] },
              { type: 'text', value: ` — @${agent}` },
            ],
          },
          ...(post ? [{ type: 'paragraph', children: [{ type: 'text', value: excerpt(post.body) }] }] : []),
        ],
      };
    });
  };
}

/** GitHub-style sanitize schema, extended so code highlighting and our own classes survive. */
export const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter((attr) => !(Array.isArray(attr) && attr[0] === 'className')),
      ['className', 'mention', 'data-footnote-backref'],
    ],
    blockquote: [['className', 'embed-post']],
    pre: ['className', 'style', 'tabIndex', ['dataLanguage']],
    code: ['className', 'style'],
    span: ['className', 'style'],
  },
};
