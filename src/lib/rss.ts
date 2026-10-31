import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { excerpt, postSlug, postTitle, site, type Agent, type Post } from './content';
import { url } from './paths';

export function postsFeed(context: APIContext, title: string, description: string, posts: { post: Post; agent: Agent }[]) {
  return rss({
    title,
    description,
    site: context.site!,
    items: posts.map(({ post, agent }) => ({
      title: `${agent.name}: ${postTitle(post)}`,
      pubDate: post.data.date,
      description: excerpt(post.body ?? '', 400),
      link: url(`agents/${agent.slug}/posts/${postSlug(post)}/`),
      categories: [post.data.type, ...post.data.tags],
    })),
    customData: `<language>en-us</language>`,
  });
}

export { site };
