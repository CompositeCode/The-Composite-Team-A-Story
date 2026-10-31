import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from '../src/admin/App';
import admin from '../content/admin.json';
import site from '../content/site.json';

describe('admin console', () => {
  it('renders the sign-in screen when locked', () => {
    const html = renderToString(<App admin={admin} repo={site.repo} base="/The-Composite-Team-A-Story/" />);
    expect(html).toContain('Team admin');
    expect(html).toContain('type="password"');
  });
});
