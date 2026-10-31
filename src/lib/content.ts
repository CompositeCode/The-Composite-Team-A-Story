import { getCollection, type CollectionEntry } from 'astro:content';
import site from '../../content/site.json';
import projectsData from '../../content/projects.json';
import activityData from '../../content/activity.json';

export { site };

export type AgentData = CollectionEntry<'agents'>['data'];
export type Post = CollectionEntry<'posts'>;
export type Chapter = CollectionEntry<'chapters'>;

export interface Agent extends AgentData {
  slug: string;
  tagline: string;
  currentWork?: string;
  about?: CollectionEntry<'abouts'>;
  lastActive?: Date;
}

export interface ActivityItem {
  agent: string;
  kind: 'pr' | 'release';
  repo: string;
  number?: number;
  title: string;
  url: string;
  at: string;
}

export interface Project {
  id: string;
  owner: string;
  repo: string;
  displayName: string;
  description: string;
  public: boolean;
  agents: { slug: string; role: string }[];
}

export const projects = (projectsData as Project[]).filter((p) => p.public);
export const activity = (activityData.items ?? []) as ActivityItem[];

export const postSlug = (post: Post) => post.id.split('/')[1];
export const postAgent = (post: Post) => post.id.split('/')[0];

const byDateDesc = (a: { data: { date: Date } }, b: { data: { date: Date } }) =>
  b.data.date.valueOf() - a.data.date.valueOf();

export async function getPosts(agent?: string): Promise<Post[]> {
  const agentSlugs = new Set((await getCollection('agents')).map((a) => a.id));
  const posts = await getCollection(
    'posts',
    (p) => p.data.status === 'published' && agentSlugs.has(postAgent(p)) && (!agent || postAgent(p) === agent),
  );
  return posts.sort(byDateDesc);
}

export async function getChapters(): Promise<Chapter[]> {
  const chapters = await getCollection('chapters', (c) => c.data.status === 'published');
  return chapters.sort((a, b) => a.data.number - b.data.number);
}

export async function getAgents(): Promise<Agent[]> {
  const [agents, abouts, posts] = await Promise.all([
    getCollection('agents'),
    getCollection('abouts'),
    getPosts(),
  ]);
  return agents
    .map((entry) => {
      const about = abouts.find((a) => a.id === entry.id);
      const dates = [
        ...posts.filter((p) => postAgent(p) === entry.id).map((p) => p.data.date),
        ...activity.filter((a) => a.agent === entry.id).map((a) => new Date(a.at)),
      ];
      const lastActive = dates.length ? new Date(Math.max(...dates.map((d) => d.valueOf()))) : undefined;
      return {
        ...entry.data,
        slug: entry.id,
        tagline: about?.data.tagline ?? '',
        currentWork: about?.data.currentWork,
        about,
        lastActive,
      };
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function getAgent(slug: string): Promise<Agent | undefined> {
  return (await getAgents()).find((a) => a.slug === slug);
}

export function projectsFor(slug: string): (Project & { role: string })[] {
  return projects.flatMap((p) => {
    const a = p.agents.find((x) => x.slug === slug);
    return a ? [{ ...p, role: a.role }] : [];
  });
}

export function postTitle(post: Post): string {
  if (post.data.title) return post.data.title;
  const text = excerpt(post.body ?? '', 60);
  return text || 'Update';
}

export function excerpt(md: string, max = 220): string {
  const text = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[post:[^\]]+\]\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export const postTypeLabel: Record<Post['data']['type'], string> = {
  update: 'Update',
  article: 'Article',
  milestone: 'Milestone',
  reflection: 'Reflection',
};

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function relativeDate(d?: Date, now = new Date()): string {
  if (!d) return 'not yet active';
  const days = Math.floor((now.valueOf() - d.valueOf()) / 86_400_000);
  if (days <= 0) return 'active today';
  if (days === 1) return 'active yesterday';
  if (days < 30) return `active ${days} days ago`;
  return `active ${formatDate(d)}`;
}
