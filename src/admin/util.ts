import YAML from 'yaml';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// ---- Markdown with YAML front matter ---------------------------------------

export function parseMd(raw: string): { data: Record<string, any>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  return { data: (YAML.parse(m[1]) as Record<string, any>) ?? {}, body: m[2].replace(/^\r?\n/, '') };
}

function clean(value: any): any {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return value;
}

export function stringifyMd(data: Record<string, any>, body: string): string {
  const yaml = YAML.stringify(clean(data), { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// ---- Preview ---------------------------------------------------------------

export function renderPreview(md: string, base: string): string {
  const withMedia = md.replace(/\]\((\/?media\/)/g, `](${base.replace(/\/+$/, '')}/media/`);
  return DOMPurify.sanitize(marked.parse(withMedia, { async: false }) as string);
}

// ---- Slugs & dates ---------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const isSlug = (s: string) => /^[a-z0-9][a-z0-9-]*$/.test(s);

/** ISO string → value for <input type="datetime-local"> (local time). */
export function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.valueOf())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? String(iso) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ---- Password hashing (format shared with scripts/hash-password.mjs) -------

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
}

export async function hashPassword(password: string, iterations = 210_000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(await pbkdf2(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256' || !iter || !salt || !hash) return false;
  const actual = b64(await pbkdf2(password, unb64(salt), Number(iter)));
  let diff = actual.length ^ hash.length;
  for (let i = 0; i < Math.min(actual.length, hash.length); i++) diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

// ---- Images ----------------------------------------------------------------

export type ImageMode = 'square' | 'banner' | 'fit';

export interface ProcessedImage {
  base64: string;
  ext: string;
  previewUrl: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Crops/resizes an uploaded image in the browser so the repo only stores
 * web-sized files. SVG and GIF pass through untouched.
 *  - square: center crop, 512×512 (avatars)
 *  - banner: center crop to 3:1, 1500×500
 *  - fit: longest side ≤ 1600 (gallery, posts, story)
 */
export async function processImage(file: File, mode: ImageMode): Promise<ProcessedImage> {
  const previewUrl = URL.createObjectURL(file);
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    if (file.size > 5_000_000) throw new Error('SVG/GIF files must be under 5 MB.');
    return { base64: await blobToBase64(file), ext: file.type === 'image/gif' ? 'gif' : 'svg', previewUrl };
  }
  const bitmap = await createImageBitmap(file);
  let sx = 0,
    sy = 0,
    sw = bitmap.width,
    sh = bitmap.height,
    dw: number,
    dh: number;
  if (mode === 'square' || mode === 'banner') {
    const ratio = mode === 'square' ? 1 : 3;
    if (sw / sh > ratio) {
      sw = Math.round(sh * ratio);
      sx = Math.round((bitmap.width - sw) / 2);
    } else {
      sh = Math.round(sw / ratio);
      sy = Math.round((bitmap.height - sh) / 2);
    }
    dw = Math.min(mode === 'square' ? 512 : 1500, sw);
    dh = Math.round(dw / ratio);
  } else {
    const scale = Math.min(1, 1600 / Math.max(sw, sh));
    dw = Math.round(sw * scale);
    dh = Math.round(sh * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))), 'image/webp', 0.86),
  );
  return { base64: await blobToBase64(blob), ext: 'webp', previewUrl: URL.createObjectURL(blob) };
}

export function randomId(len = 6): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => (b % 36).toString(36)).join('');
}

// ---- GitHub links on posts --------------------------------------------------

export interface GithubRef {
  kind: string;
  url: string;
  repo?: string;
  number?: number;
  title?: string;
}

/** Turns pasted GitHub URLs into typed refs (repo, pr, issue, commit, release). */
export function parseRefs(text: string): GithubRef[] {
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^https:\/\/github\.com\//.test(s))
    .map((url) => {
      const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)(?:\/(pull|issues|commit|releases\/tag)\/([^/#?]+))?/);
      const repo = m?.[1];
      const kind = m?.[2] === 'pull' ? 'pr' : m?.[2] === 'issues' ? 'issue' : m?.[2] === 'commit' ? 'commit' : m?.[2] ? 'release' : 'repo';
      const num = kind === 'pr' || kind === 'issue' ? Number(m?.[3]) : undefined;
      return { kind, url, repo, number: Number.isFinite(num) ? num : undefined };
    });
}
