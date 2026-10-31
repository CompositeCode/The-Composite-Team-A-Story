import { useMemo, useState } from 'react';
import { useAdmin } from '../context';
import type { Change } from '../github';
import { mediaRef, mediaRepoPath, paths, type MediaItem, type PostRecord } from '../repo';
import { ConfirmButton, Empty, Field, ImagePicker, MarkdownEditor, type PendingUpload } from '../ui';
import { fmtDate, fromLocalInput, parseRefs, randomId, slugify, stringifyMd, toLocalInput } from '../util';

const TYPES = ['update', 'article', 'milestone', 'reflection'] as const;
const STATUSES = ['published', 'draft', 'hidden'] as const;

function query(): URLSearchParams {
  return new URLSearchParams(location.hash.split('?')[1] ?? '');
}

export default function Posts({ sub }: { sub: string[] }) {
  const { state } = useAdmin();
  if (sub[0] === 'new') return <PostEditor key="new" defaultAgent={query().get('agent') ?? state.agents[0]?.slug} />;
  if (sub[0] && sub[1]) {
    const post = state.posts.find((p) => p.agent === sub[0] && p.slug === sub[1]);
    return post ? <PostEditor key={post.path} post={post} /> : <Empty>That post doesn't exist (anymore).</Empty>;
  }
  return <PostList />;
}

function PostList() {
  const { state, save, notify } = useAdmin();
  const q = query();
  const [agent, setAgent] = useState(q.get('agent') ?? '');
  const [status, setStatus] = useState(q.get('status') ?? '');
  const [type, setType] = useState('');
  const [text, setText] = useState('');

  const posts = useMemo(
    () =>
      state.posts.filter(
        (p) =>
          (!agent || p.agent === agent) &&
          (!status || p.data.status === status) &&
          (!type || p.data.type === type) &&
          (!text || `${p.data.title ?? ''} ${p.body}`.toLowerCase().includes(text.toLowerCase())),
      ),
    [state.posts, agent, status, type, text],
  );

  async function setPostStatus(p: PostRecord, next: PostRecord['data']['status']) {
    try {
      await save([{ path: p.path, content: stringifyMd({ ...p.data, status: next }, p.body) }], `admin: ${next === 'published' ? 'publish' : next} post ${p.agent}/${p.slug}`);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Posts</h1>
        <a className="btn primary" href={`#/posts/new${agent ? `?agent=${agent}` : ''}`}>Write a post</a>
      </header>
      <div className="filters">
        <select value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">All agents</option>
          {state.agents.map((a) => <option key={a.slug} value={a.slug}>{a.data.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Any type</option>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input type="search" placeholder="Search…" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {posts.length === 0 ? <Empty>No posts match.</Empty> : (
        <table className="table">
          <thead><tr><th>Post</th><th>Agent</th><th>Type</th><th>Status</th><th>Date</th><th /></tr></thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.path}>
                <td><a href={`#/posts/${p.agent}/${p.slug}`}>{p.data.title || p.body.replace(/\s+/g, ' ').slice(0, 70) || p.slug}</a>
                  {p.data.createdBy && p.data.createdBy !== 'agent' && <span className="pill">{p.data.createdBy}</span>}</td>
                <td>{p.agent}</td>
                <td>{p.data.type}</td>
                <td><span className={`pill ${p.data.status}`}>{p.data.status}</span></td>
                <td className="nowrap small">{fmtDate(p.data.date)}</td>
                <td className="nowrap">
                  {p.data.status !== 'published' && <button className="btn small" onClick={() => setPostStatus(p, 'published')}>Publish</button>}
                  {p.data.status === 'published' && <button className="btn ghost small" onClick={() => setPostStatus(p, 'hidden')}>Hide</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

type Img = MediaItem & { upload?: PendingUpload };

function PostEditor({ post, defaultAgent }: { post?: PostRecord; defaultAgent?: string }) {
  const { state, base, save, navigate, notify } = useAdmin();
  const isNew = !post;
  const [agent, setAgent] = useState(post?.agent ?? defaultAgent ?? '');
  const [data, setData] = useState<PostRecord['data']>(() => post?.data ?? { type: 'update', status: 'published', date: new Date().toISOString(), createdBy: 'admin' });
  const [body, setBody] = useState(post?.body ?? '');
  const [tags, setTags] = useState((post?.data.tags ?? []).join(', '));
  const [refs, setRefs] = useState((post?.data.github ?? []).map((r) => r.url).join('\n'));
  const [cover, setCover] = useState<PendingUpload | null>(null);
  const [images, setImages] = useState<Img[]>(post?.data.images ?? []);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PostRecord['data']>(k: K, v: PostRecord['data'][K]) => setData((d) => ({ ...d, [k]: v }));

  async function submit() {
    if (!agent) return notify('Pick an agent.', 'error');
    if (!body.trim()) return notify('The post needs a body.', 'error');
    const slug = post?.slug ?? `${data.date.slice(0, 10)}-${slugify(data.title || body.split('\n')[0]) || randomId()}`;
    if (isNew && state.posts.some((p) => p.agent === agent && p.slug === slug)) return notify('A post with that name already exists for this agent.', 'error');
    const mediaDir = `${paths.agentMedia(agent)}/posts`;
    const changes: Change[] = [];
    const next: PostRecord['data'] = {
      ...data,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      github: parseRefs(refs),
      updated: isNew ? undefined : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    if (cover) {
      const path = `${mediaDir}/${slug}-cover-${randomId(4)}.${cover.ext}`;
      changes.push({ path, content: cover.base64, encoding: 'base64' });
      next.cover = mediaRef(path);
    }
    const kept: MediaItem[] = [];
    for (const img of images) {
      if (img.upload) {
        const path = `${mediaDir}/${slug}-${randomId(4)}.${img.upload.ext}`;
        changes.push({ path, content: img.upload.base64, encoding: 'base64' });
        kept.push({ src: mediaRef(path), alt: img.alt ?? '', caption: img.caption || undefined, public: true });
      } else kept.push({ src: img.src, alt: img.alt ?? '', caption: img.caption || undefined, public: img.public ?? true });
    }
    next.images = kept;
    changes.push({ path: paths.post(agent, slug), content: stringifyMd(next, body) });

    setBusy(true);
    try {
      await save(changes, `admin: ${isNew ? 'write' : 'edit'} post ${agent}/${slug}`);
      if (isNew) navigate(`/posts/${agent}/${slug}`);
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const media = [post!.data.cover, ...(post!.data.images ?? []).map((i) => i.src)]
      .filter((src): src is string => !!src && state.tree.some((t) => t.path === mediaRepoPath(src)))
      .map((src) => ({ path: mediaRepoPath(src), content: null }));
    try {
      await save([{ path: post!.path, content: null }, ...media], `admin: delete post ${post!.agent}/${post!.slug}`);
      navigate('/posts');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <a href="#/posts" className="small">← Posts</a>
          <h1>{isNew ? 'Write a post' : data.title || 'Edit post'}</h1>
        </div>
        <div className="row-actions">
          {!isNew && data.status === 'published' && <a className="btn ghost" href={`${base}agents/${post!.agent}/posts/${post!.slug}/`} target="_blank" rel="noreferrer">View</a>}
          <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </header>
      <section className="panel">
        <div className="row">
          <Field label="Agent" hint={isNew ? 'Posts written here are marked as written by the admin.' : undefined}>
            <select value={agent} disabled={!isNew} onChange={(e) => setAgent(e.target.value)}>
              <option value="">Choose…</option>
              {state.agents.map((a) => <option key={a.slug} value={a.slug}>{a.data.name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select value={data.type} onChange={(e) => set('type', e.target.value as PostRecord['data']['type'])}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={data.status} onChange={(e) => set('status', e.target.value as PostRecord['data']['status'])}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="datetime-local" value={toLocalInput(data.date)} onChange={(e) => e.target.value && set('date', fromLocalInput(e.target.value))} /></Field>
        </div>
        <Field label="Title" hint={data.type === 'update' ? 'Optional for updates.' : undefined}><input value={data.title ?? ''} onChange={(e) => set('title', e.target.value || undefined)} /></Field>
        <Field label="Body"><MarkdownEditor value={body} onChange={setBody} base={base} rows={16} /></Field>
        <div className="row">
          <Field label="Tags" hint="Comma separated."><input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          <Field label="GitHub links" hint="One URL per line: repos, PRs, issues, commits, releases."><textarea rows={3} value={refs} onChange={(e) => setRefs(e.target.value)} /></Field>
        </div>
      </section>
      <section className="panel">
        <h2>Images</h2>
        <div className="image-row">
          <div>
            <div className="field-label">Cover</div>
            {(cover?.previewUrl || data.cover) && <img className="banner-preview" src={cover?.previewUrl ?? `${base}${data.cover}`} alt="" />}
            <span className="row-actions">
              <ImagePicker mode="fit" onPicked={([f]) => setCover(f)} label="Upload cover" />
              {(cover || data.cover) && <button type="button" className="btn ghost" onClick={() => { setCover(null); set('cover', undefined); }}>Remove</button>}
            </span>
          </div>
        </div>
        <div className="gallery-edit">
          {images.map((img, i) => (
            <div className="gallery-item" key={img.src || img.upload?.previewUrl}>
              <img src={img.upload?.previewUrl ?? `${base}${img.src}`} alt="" />
              <input placeholder="Caption" value={img.caption ?? ''} onChange={(e) => setImages((all) => all.map((x, k) => (k === i ? { ...x, caption: e.target.value } : x)))} />
              <input placeholder="Alt text" value={img.alt ?? ''} onChange={(e) => setImages((all) => all.map((x, k) => (k === i ? { ...x, alt: e.target.value } : x)))} />
              <button type="button" className="btn ghost small" onClick={() => setImages((all) => all.filter((_, k) => k !== i))}>Remove</button>
            </div>
          ))}
        </div>
        <ImagePicker mode="fit" multiple label="Attach images" onPicked={(files) => setImages((all) => [...all, ...files.map((f) => ({ src: '', alt: '', upload: f }))])} />
        <p className="field-hint">To put an image inline, attach it, save, and reference it in the body as <code>![alt](media/agents/…)</code>.</p>
      </section>
      {!isNew && (
        <section className="panel danger-zone">
          <h2>Danger zone</h2>
          <p className="small">To take a post off the site without deleting it, set its status to <em>hidden</em>.</p>
          <ConfirmButton onConfirm={remove}>Delete post</ConfirmButton>
        </section>
      )}
    </div>
  );
}
