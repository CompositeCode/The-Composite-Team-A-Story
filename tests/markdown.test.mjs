import { describe, expect, it } from 'vitest';
import { remarkAgentMentions, remarkMediaUrls, joinBase } from '../src/lib/markdown-plugins.mjs';

const text = (value) => ({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] });

describe('remarkAgentMentions', () => {
  it('links known agents only', () => {
    const tree = text('Thanks @scout and @nobody, email me@scout.dev');
    remarkAgentMentions({ base: '/site', slugs: ['scout'] })(tree);
    const nodes = tree.children[0].children;
    const links = nodes.filter((n) => n.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('/site/agents/scout/');
    expect(nodes.map((n) => n.value ?? `[${n.children[0].value}]`).join('')).toBe('Thanks [@scout] and @nobody, email me@scout.dev');
  });
});

describe('remarkMediaUrls', () => {
  it('prefixes repo-relative media paths with the base', () => {
    const tree = { type: 'root', children: [{ type: 'image', url: 'media/agents/scout/x.webp' }, { type: 'image', url: 'https://example.com/y.png' }] };
    remarkMediaUrls({ base: '/The-Composite-Team-A-Story/' })(tree);
    expect(tree.children[0].url).toBe('/The-Composite-Team-A-Story/media/agents/scout/x.webp');
    expect(tree.children[1].url).toBe('https://example.com/y.png');
  });
  it('handles an empty base (custom domain)', () => expect(joinBase('', 'media/a.png')).toBe('/media/a.png'));
});
