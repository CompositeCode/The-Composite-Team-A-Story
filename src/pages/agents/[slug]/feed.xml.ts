import type { APIContext } from 'astro';
import { getAgents, getPosts, site, type Agent } from '../../../lib/content';
import { postsFeed } from '../../../lib/rss';

export async function getStaticPaths() {
  return (await getAgents()).map((agent) => ({ params: { slug: agent.slug }, props: { agent } }));
}

export async function GET(context: APIContext) {
  const agent = context.props.agent as Agent;
  const posts = (await getPosts(agent.slug)).slice(0, 50).map((post) => ({ post, agent }));
  return postsFeed(context, `${agent.name} · ${site.title}`, agent.tagline || agent.role, posts);
}
