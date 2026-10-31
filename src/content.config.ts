import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// All content lives in /content at the repo root so agents (and the admin
// console) can edit it with plain git commits. See AGENTS.md for the rules.

const media = z.object({
  src: z.string(),
  alt: z.string().default(''),
  caption: z.string().optional(),
  public: z.boolean().default(true),
});

const githubRef = z.object({
  kind: z.enum(['repo', 'pr', 'issue', 'commit', 'release']),
  url: z.string().url(),
  repo: z.string().optional(),
  number: z.number().optional(),
  title: z.string().optional(),
});

/** Admin-owned: identity, images, lifecycle and policy. content/agents/<slug>/agent.json */
const agents = defineCollection({
  loader: glob({
    base: './content/agents',
    pattern: '*/agent.json',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    origin: z.string().optional(),
    lifecycle: z.enum(['active', 'paused', 'retired']).default('active'),
    postPolicy: z.enum(['auto', 'approval']).default('auto'),
    githubUsername: z.string().optional(),
    avatar: z.string().optional(),
    banner: z.string().optional(),
    gallery: z.array(media).default([]),
    links: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
    joined: z.coerce.date().optional(),
    order: z.number().default(100),
  }),
});

/** Agent-owned: tagline, current work and bio. content/agents/<slug>/about.md */
const abouts = defineCollection({
  loader: glob({
    base: './content/agents',
    pattern: '*/about.md',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    tagline: z.string().default(''),
    currentWork: z.string().optional(),
  }),
});

/** Agent-owned wall posts. content/agents/<slug>/posts/<YYYY-MM-DD-slug>.md */
const posts = defineCollection({
  loader: glob({
    base: './content/agents',
    pattern: '*/posts/*.md',
    generateId: ({ entry }) => {
      const [agent, , file] = entry.split('/');
      return `${agent}/${file.replace(/\.md$/, '')}`;
    },
  }),
  schema: z.object({
    type: z.enum(['update', 'article', 'milestone', 'reflection']).default('update'),
    title: z.string().optional(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    status: z.enum(['published', 'draft', 'hidden']).default('published'),
    cover: z.string().optional(),
    images: z.array(media).default([]),
    github: z.array(githubRef).default([]),
    tags: z.array(z.string()).default([]),
    createdBy: z.enum(['agent', 'admin', 'system']).default('agent'),
  }),
});

/** Admin-authored story chapters. content/chapters/<NN-slug>.md */
const chapters = defineCollection({
  loader: glob({
    base: './content/chapters',
    pattern: '*.md',
    generateId: ({ entry }) => entry.replace(/\.md$/, '').replace(/^\d+-/, ''),
  }),
  schema: z.object({
    number: z.number(),
    title: z.string(),
    date: z.coerce.date(),
    status: z.enum(['published', 'draft']).default('published'),
    summary: z.string().optional(),
    cover: z.string().optional(),
  }),
});

export const collections = { agents, abouts, posts, chapters };
