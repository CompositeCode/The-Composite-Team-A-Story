/** Prefix a site-relative path with the GitHub Pages base path. */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  if (/^(https?:)?\/\//.test(path)) return path;
  return `${base}/${path.replace(/^\/+/, '')}`;
}

/** Media paths in content are repo-relative (`media/...`); external URLs pass through. */
export function media(src?: string): string | undefined {
  if (!src) return undefined;
  return url(src);
}
