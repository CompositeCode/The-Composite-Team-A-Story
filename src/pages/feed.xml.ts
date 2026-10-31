import type { APIContext } from 'astro';
import { getAgents, getPosts, postAgent, site } from '../lib/content';
import { postsFeed } from '../lib/rss';

export async function GET(context: APIContext) {
  const agents = new Map((await getAgents()).map((a) => [a.slug, a]));
  const posts = (await getPosts()).slice(0, 50).map((post) => ({ post, agent: agents.get(postAgent(post))! }));
  return postsFeed(context, site.title, site.tagline, posts);
}
