import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { excerpt, getChapters, site } from '../../lib/content';
import { url } from '../../lib/paths';

export async function GET(context: APIContext) {
  const chapters = await getChapters();
  return rss({
    title: `${site.title}: The Story`,
    description: 'The ongoing story, chapter by chapter.',
    site: context.site!,
    items: chapters.map((c) => ({
      title: `Chapter ${c.data.number}: ${c.data.title}`,
      pubDate: c.data.date,
      description: c.data.summary ?? excerpt(c.body ?? '', 400),
      link: url(`story/${c.id}/`),
    })),
  });
}
