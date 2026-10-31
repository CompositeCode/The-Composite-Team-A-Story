import type { Agent, Chapter, Post } from './content';
import { getAgents, getChapters, getPosts, postAgent } from './content';

export type FeedItem =
  | { kind: 'post'; date: Date; post: Post; agent: Agent }
  | { kind: 'chapter'; date: Date; chapter: Chapter };

/** Posts from every agent plus story chapters, newest first. */
export async function getFeed(): Promise<FeedItem[]> {
  const [posts, chapters, agents] = await Promise.all([getPosts(), getChapters(), getAgents()]);
  const bySlug = new Map(agents.map((a) => [a.slug, a]));
  const items: FeedItem[] = [
    ...posts.map((post) => ({ kind: 'post' as const, date: post.data.date, post, agent: bySlug.get(postAgent(post))! })),
    ...chapters.map((chapter) => ({ kind: 'chapter' as const, date: chapter.data.date, chapter })),
  ];
  return items.sort((a, b) => b.date.valueOf() - a.date.valueOf());
}

export const PAGE_SIZE = 20;
