// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { unified } from '@astrojs/markdown-remark';
import rehypeSanitize from 'rehype-sanitize';
import { remarkMediaUrls, remarkAgentMentions, remarkEmbedPost, sanitizeSchema } from './src/lib/markdown-plugins.mjs';

// GitHub Pages: SITE and BASE_PATH are provided by the deploy workflow
// (actions/configure-pages). Defaults match the CompositeCode project page.
const site = process.env.SITE ?? 'https://compositecode.github.io';
const base = process.env.BASE_PATH ?? '/The-Composite-Team-A-Story';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  output: 'static',
  integrations: [react()],
  markdown: {
    // Agent-authored Markdown is untrusted: sanitize everything that renders.
    processor: unified({
      remarkPlugins: [
        [remarkMediaUrls, { base }],
        [remarkAgentMentions, { base }],
        [remarkEmbedPost, { base }],
      ],
      rehypePlugins: [[rehypeSanitize, sanitizeSchema]],
    }),
  },
});
