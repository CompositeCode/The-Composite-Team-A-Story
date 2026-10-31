import type { GitHub, TreeEntry } from './github';
import { parseMd } from './util';

// Paths mirror src/content.config.ts and AGENTS.md.
export const paths = {
  site: 'content/site.json',
  admin: 'content/admin.json',
  projects: 'content/projects.json',
  activity: 'content/activity.json',
  agentDir: (slug: string) => `content/agents/${slug}`,
  agentJson: (slug: string) => `content/agents/${slug}/agent.json`,
  about: (slug: string) => `content/agents/${slug}/about.md`,
  post: (slug: string, post: string) => `content/agents/${slug}/posts/${post}.md`,
  chapter: (file: string) => `content/chapters/${file}.md`,
  agentMedia: (slug: string) => `public/media/agents/${slug}`,
  storyMedia: 'public/media/story',
};

/** `public/media/x.png` (repo path) ⇄ `media/x.png` (content reference). */
export const mediaRef = (repoPath: string) => repoPath.replace(/^public\//, '');
export const mediaRepoPath = (ref: string) => `public/${ref.replace(/^\/+/, '')}`;

export interface MediaItem {
  src: string;
  alt?: string;
  caption?: string;
  public?: boolean;
}

export interface AgentJson {
  name: string;
  role: string;
  origin?: string;
  lifecycle: 'active' | 'paused' | 'retired';
  postPolicy: 'auto' | 'approval';
  githubUsername?: string;
  avatar?: string;
  banner?: string;
  gallery: MediaItem[];
  links: { label: string; url: string }[];
  joined?: string;
  order?: number;
}

export interface AgentRecord {
  slug: string;
  data: AgentJson;
  about: { tagline?: string; currentWork?: string; body: string };
}

export interface PostRecord {
  agent: string;
  slug: string;
  path: string;
  data: {
    type: 'update' | 'article' | 'milestone' | 'reflection';
    title?: string;
    date: string;
    updated?: string;
    status: 'published' | 'draft' | 'hidden';
    cover?: string;
    images?: MediaItem[];
    github?: { kind: string; url: string; repo?: string; number?: number; title?: string }[];
    tags?: string[];
    createdBy?: 'agent' | 'admin' | 'system';
  };
  body: string;
}

export interface ChapterRecord {
  file: string; // e.g. "00-prologue"
  path: string;
  data: { number: number; title: string; date: string; status: 'published' | 'draft'; summary?: string; cover?: string };
  body: string;
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

export interface SiteJson {
  title: string;
  tagline: string;
  about: string;
  socialImage?: string;
  repo: { owner: string; name: string; branch: string };
  github: { orgUrl: string };
}

export interface AdminJson {
  email: string;
  passwordHash: string;
  mustChangePassword: boolean;
}

export interface RepoState {
  tree: TreeEntry[];
  site: SiteJson;
  admin: AdminJson;
  projects: Project[];
  activity: { generatedAt: string | null; items: any[] };
  agents: AgentRecord[];
  posts: PostRecord[];
  chapters: ChapterRecord[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function loadRepo(gh: GitHub): Promise<RepoState> {
  const tree = await gh.tree();
  const sha = new Map(tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));
  const text = async (path: string, fallback = '') => (sha.has(path) ? gh.blobText(sha.get(path)!) : fallback);
  const readJson = async <T,>(path: string, fallback: T): Promise<T> => {
    const raw = await text(path);
    return raw ? (JSON.parse(raw) as T) : fallback;
  };

  const agentSlugs = [...sha.keys()]
    .map((p) => p.match(/^content\/agents\/([^/]+)\/agent\.json$/)?.[1])
    .filter((s): s is string => !!s);
  const postPaths = [...sha.keys()].filter((p) => /^content\/agents\/[^/]+\/posts\/[^/]+\.md$/.test(p));
  const chapterPaths = [...sha.keys()].filter((p) => /^content\/chapters\/[^/]+\.md$/.test(p));

  const [site, admin, projects, activity] = await Promise.all([
    readJson<SiteJson>(paths.site, {} as SiteJson),
    readJson<AdminJson>(paths.admin, {} as AdminJson),
    readJson<Project[]>(paths.projects, []),
    readJson(paths.activity, { generatedAt: null, items: [] }),
  ]);

  const agents = await mapLimit(agentSlugs, 6, async (slug) => {
    const data = await readJson<Partial<AgentJson>>(paths.agentJson(slug), {});
    const about = parseMd(await text(paths.about(slug)));
    return {
      slug,
      data: { gallery: [], links: [], lifecycle: 'active', postPolicy: 'auto', ...data },
      about: { tagline: about.data.tagline, currentWork: about.data.currentWork, body: about.body },
    } as AgentRecord;
  });

  const posts = await mapLimit(postPaths, 8, async (path) => {
    const [, agent, , file] = path.split('/').slice(1);
    const { data, body } = parseMd(await text(path));
    return {
      agent,
      slug: file.replace(/\.md$/, ''),
      path,
      data: { type: 'update', status: 'published', ...data, date: String(data.date ?? '') },
      body,
    } as PostRecord;
  });

  const chapters = await mapLimit(chapterPaths, 6, async (path) => {
    const { data, body } = parseMd(await text(path));
    return {
      file: path.split('/').pop()!.replace(/\.md$/, ''),
      path,
      data: { status: 'published', ...data, date: String(data.date ?? '') },
      body,
    } as ChapterRecord;
  });

  return {
    tree,
    site,
    admin,
    projects,
    activity,
    agents: agents.sort((a, b) => (a.data.order ?? 100) - (b.data.order ?? 100) || a.data.name.localeCompare(b.data.name)),
    posts: posts.sort((a, b) => b.data.date.localeCompare(a.data.date)),
    chapters: chapters.sort((a, b) => a.data.number - b.data.number),
  };
}

/** Every blob path under a prefix (for deleting an agent's folders). */
export function filesUnder(tree: TreeEntry[], prefix: string): string[] {
  return tree.filter((t) => t.type === 'blob' && t.path.startsWith(`${prefix}/`)).map((t) => t.path);
}
