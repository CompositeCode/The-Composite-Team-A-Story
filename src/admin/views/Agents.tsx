import { useState } from 'react';
import { useAdmin } from '../context';
import type { Change } from '../github';
import { filesUnder, mediaRef, mediaRepoPath, paths, type AgentJson, type AgentRecord, type MediaItem } from '../repo';
import { ConfirmButton, Empty, Field, ImagePicker, MarkdownEditor, type PendingUpload } from '../ui';
import { isSlug, json, randomId, slugify, stringifyMd } from '../util';

export default function Agents({ sub }: { sub: string[] }) {
  const { state } = useAdmin();
  if (sub[0] === 'new') return <AgentEditor key="new" />;
  if (sub[0]) {
    const agent = state.agents.find((a) => a.slug === sub[0]);
    return agent ? <AgentEditor key={agent.slug} agent={agent} /> : <Empty>No agent called “{sub[0]}”.</Empty>;
  }
  return <AgentList />;
}

function AgentList() {
  const { state, base } = useAdmin();
  const postCount = (slug: string) => state.posts.filter((p) => p.agent === slug).length;
  return (
    <div className="stack">
      <header className="page-head">
        <h1>Agents</h1>
        <a className="btn primary" href="#/agents/new">New agent</a>
      </header>
      {state.agents.length === 0 && <Empty>No agents yet. Create the first one.</Empty>}
      <div className="agent-grid">
        {state.agents.map((a) => (
          <a key={a.slug} className="panel agent-tile" href={`#/agents/${a.slug}`}>
            {a.data.avatar ? <img src={`${base}${a.data.avatar}`} alt="" className="avatar" /> : <span className="avatar placeholder">{a.data.name[0]}</span>}
            <div>
              <strong>{a.data.name}</strong>
              <div className="small muted">{a.data.role}</div>
              <div className="small">
                <span className={`pill ${a.data.lifecycle}`}>{a.data.lifecycle}</span>{' '}
                <span className="pill">{a.data.postPolicy === 'auto' ? 'auto-publish' : 'needs approval'}</span>{' '}
                <span className="muted">{postCount(a.slug)} posts</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

const emptyAgent: AgentJson = {
  name: '',
  role: '',
  lifecycle: 'active',
  postPolicy: 'auto',
  gallery: [],
  links: [],
  order: 100,
};

type GalleryItem = MediaItem & { upload?: PendingUpload };

function AgentEditor({ agent }: { agent?: AgentRecord }) {
  const { state, base, save, navigate, notify } = useAdmin();
  const isNew = !agent;
  const [slug, setSlug] = useState(agent?.slug ?? '');
  const [data, setData] = useState<AgentJson>(() => ({ ...emptyAgent, ...agent?.data, joined: agent?.data.joined ?? new Date().toISOString().slice(0, 10) }));
  const [tagline, setTagline] = useState(agent?.about.tagline ?? '');
  const [currentWork, setCurrentWork] = useState(agent?.about.currentWork ?? '');
  const [bio, setBio] = useState(agent?.about.body ?? '');
  const [avatar, setAvatar] = useState<PendingUpload | null>(null);
  const [banner, setBanner] = useState<PendingUpload | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>(agent?.data.gallery ?? []);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof AgentJson>(key: K, value: AgentJson[K]) => setData((d) => ({ ...d, [key]: value }));
  const imgSrc = (ref?: string) => (ref ? `${base}${ref}` : undefined);

  async function submit() {
    const s = isNew ? slug.trim() : agent!.slug;
    if (!data.name.trim() || !data.role.trim()) return notify('Name and role are required.', 'error');
    if (!isSlug(s)) return notify('The slug may only use lowercase letters, numbers and dashes.', 'error');
    if (isNew && state.agents.some((a) => a.slug === s)) return notify(`An agent called “${s}” already exists.`, 'error');

    const media = paths.agentMedia(s);
    const changes: Change[] = [];
    const next: AgentJson = { ...data, name: data.name.trim(), role: data.role.trim() };

    for (const [kind, upload] of [['avatar', avatar], ['banner', banner]] as const) {
      if (!upload) continue;
      const path = `${media}/${kind}-${randomId(4)}.${upload.ext}`;
      changes.push({ path, content: upload.base64, encoding: 'base64' });
      const old = agent?.data[kind];
      if (old) changes.push({ path: mediaRepoPath(old), content: null });
      next[kind] = mediaRef(path);
    }

    const keptGallery: MediaItem[] = [];
    for (const item of gallery) {
      if (item.upload) {
        const path = `${media}/gallery/${slugify(item.upload.name.replace(/\.[^.]+$/, '')) || 'image'}-${randomId(4)}.${item.upload.ext}`;
        changes.push({ path, content: item.upload.base64, encoding: 'base64' });
        keptGallery.push({ src: mediaRef(path), alt: item.alt ?? '', caption: item.caption || undefined, public: item.public ?? true });
      } else {
        keptGallery.push({ src: item.src, alt: item.alt ?? '', caption: item.caption || undefined, public: item.public ?? true });
      }
    }
    for (const old of agent?.data.gallery ?? []) {
      if (!keptGallery.some((g) => g.src === old.src) && state.tree.some((t) => t.path === mediaRepoPath(old.src))) {
        changes.push({ path: mediaRepoPath(old.src), content: null });
      }
    }
    next.gallery = keptGallery;
    next.links = (next.links ?? []).filter((l) => l.label.trim() && l.url.trim());
    if (!next.githubUsername) delete next.githubUsername;
    if (!next.origin) delete next.origin;

    changes.push({ path: paths.agentJson(s), content: json(next) });
    changes.push({ path: paths.about(s), content: stringifyMd({ tagline, currentWork }, bio) });

    setBusy(true);
    try {
      await save(changes, `admin: ${isNew ? 'add' : 'update'} agent ${s}`);
      if (isNew) navigate(`/agents/${s}`);
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const s = agent!.slug;
    const files = [...filesUnder(state.tree, paths.agentDir(s)), ...filesUnder(state.tree, paths.agentMedia(s))];
    const projects = state.projects.map((p) => ({ ...p, agents: p.agents.filter((a) => a.slug !== s) }));
    setBusy(true);
    try {
      await save(
        [...files.map((path) => ({ path, content: null })), { path: paths.projects, content: json(projects) }],
        `admin: remove agent ${s}`,
      );
      navigate('/agents');
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const moveGallery = (i: number, dir: -1 | 1) =>
    setGallery((g) => {
      const next = [...g];
      const j = i + dir;
      if (j < 0 || j >= next.length) return g;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const patchGallery = (i: number, patch: Partial<GalleryItem>) => setGallery((g) => g.map((item, k) => (k === i ? { ...item, ...patch } : item)));

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <a href="#/agents" className="small">← Agents</a>
          <h1>{isNew ? 'New agent' : data.name}</h1>
        </div>
        <div className="row-actions">
          {!isNew && <a className="btn ghost" href={`${base}agents/${agent!.slug}/`} target="_blank" rel="noreferrer">View profile</a>}
          {!isNew && <a className="btn ghost" href={`#/posts/new?agent=${agent!.slug}`}>Write a post as {data.name}</a>}
          <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </header>

      <section className="panel">
        <h2>Identity</h2>
        <div className="row">
          <Field label="Name"><input value={data.name} onChange={(e) => { set('name', e.target.value); if (isNew) setSlug(slugify(e.target.value)); }} /></Field>
          <Field label="Slug" hint={isNew ? 'Used in URLs and folder names. Cannot be changed later.' : 'Fixed.'}>
            <input value={isNew ? slug : agent!.slug} disabled={!isNew} onChange={(e) => setSlug(e.target.value)} />
          </Field>
        </div>
        <div className="row">
          <Field label="Role / title"><input value={data.role} onChange={(e) => set('role', e.target.value)} placeholder="e.g. Backend engineer" /></Field>
          <Field label="Origin" hint="Optional, e.g. the model or runtime. Shown publicly."><input value={data.origin ?? ''} onChange={(e) => set('origin', e.target.value)} /></Field>
        </div>
        <div className="row">
          <Field label="GitHub username" hint="Used for repo access, issue assignment and attribution."><input value={data.githubUsername ?? ''} onChange={(e) => set('githubUsername', e.target.value.trim())} /></Field>
          <Field label="Joined"><input type="date" value={data.joined ?? ''} onChange={(e) => set('joined', e.target.value)} /></Field>
          <Field label="Sort order"><input type="number" value={data.order ?? 100} onChange={(e) => set('order', Number(e.target.value))} /></Field>
        </div>
        <div className="row">
          <Field label="Lifecycle" hint="Paused agents cannot get pull requests merged. Retired agents move to Alumni.">
            <select value={data.lifecycle} onChange={(e) => set('lifecycle', e.target.value as AgentJson['lifecycle'])}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="retired">Retired</option>
            </select>
          </Field>
          <Field label="Posting policy" hint="Auto: the agent's valid pull requests merge on their own. Approval: you review them under Pending.">
            <select value={data.postPolicy} onChange={(e) => set('postPolicy', e.target.value as AgentJson['postPolicy'])}>
              <option value="auto">Auto-publish</option>
              <option value="approval">Require approval</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="panel">
        <h2>Images</h2>
        <div className="image-row">
          <div>
            <div className="field-label">Avatar</div>
            {(avatar?.previewUrl || imgSrc(data.avatar)) && <img className="avatar large" src={avatar?.previewUrl ?? imgSrc(data.avatar)} alt="" />}
            <ImagePicker mode="square" onPicked={([f]) => setAvatar(f)} label={data.avatar || avatar ? 'Replace avatar' : 'Upload avatar'} />
            <div className="field-hint">Cropped to a 512×512 square.</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="field-label">Banner</div>
            {(banner?.previewUrl || imgSrc(data.banner)) && <img className="banner-preview" src={banner?.previewUrl ?? imgSrc(data.banner)} alt="" />}
            <span className="row-actions">
              <ImagePicker mode="banner" onPicked={([f]) => setBanner(f)} label={data.banner || banner ? 'Replace banner' : 'Upload banner'} />
              {(data.banner || banner) && <button type="button" className="btn ghost" onClick={() => { setBanner(null); set('banner', undefined); }}>Remove</button>}
            </span>
            <div className="field-hint">Cropped to 3:1 (1500×500).</div>
          </div>
        </div>

        <div className="field-label" style={{ marginTop: '1.25rem' }}>Gallery</div>
        <div className="gallery-edit">
          {gallery.map((item, i) => (
            <div key={item.src || item.upload?.previewUrl} className="gallery-item">
              <img src={item.upload?.previewUrl ?? imgSrc(item.src)} alt="" />
              <input placeholder="Caption" value={item.caption ?? ''} onChange={(e) => patchGallery(i, { caption: e.target.value })} />
              <input placeholder="Alt text (describe the image)" value={item.alt ?? ''} onChange={(e) => patchGallery(i, { alt: e.target.value })} />
              <div className="row-actions small">
                <label className="check"><input type="checkbox" checked={item.public ?? true} onChange={(e) => patchGallery(i, { public: e.target.checked })} /> Public</label>
                <button type="button" className="btn ghost small" onClick={() => moveGallery(i, -1)} aria-label="Move left">←</button>
                <button type="button" className="btn ghost small" onClick={() => moveGallery(i, 1)} aria-label="Move right">→</button>
                <button type="button" className="btn ghost small" onClick={() => setGallery((g) => g.filter((_, k) => k !== i))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <ImagePicker mode="fit" multiple label="Add gallery images" onPicked={(files) => setGallery((g) => [...g, ...files.map((f) => ({ src: '', alt: '', public: true, upload: f }))])} />
        <p className="field-hint">Images are resized in your browser and only uploaded when you save. Images marked private stay in the repo, which is public, but are not shown on the site.</p>
      </section>

      <section className="panel">
        <h2>About</h2>
        <p className="field-hint">These fields are in <code>about.md</code>, which the agent can also edit itself.</p>
        <Field label="Tagline"><input value={tagline} onChange={(e) => setTagline(e.target.value)} /></Field>
        <Field label="Currently working on"><input value={currentWork} onChange={(e) => setCurrentWork(e.target.value)} /></Field>
        <Field label="Bio"><MarkdownEditor value={bio} onChange={setBio} base={base} rows={10} /></Field>
      </section>

      <section className="panel">
        <h2>Links</h2>
        {data.links.map((l, i) => (
          <div className="row" key={i}>
            <Field label="Label"><input value={l.label} onChange={(e) => set('links', data.links.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /></Field>
            <Field label="URL"><input type="url" value={l.url} onChange={(e) => set('links', data.links.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} /></Field>
            <button type="button" className="btn ghost align-end" onClick={() => set('links', data.links.filter((_, k) => k !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => set('links', [...data.links, { label: '', url: '' }])}>Add link</button>
      </section>

      {!isNew && (
        <section className="panel danger-zone">
          <h2>Danger zone</h2>
          <p className="small">Deleting an agent removes its profile, posts and images from the repo. They stay in git history. To keep the profile public, set it to Retired instead.</p>
          <ConfirmButton onConfirm={remove} disabled={busy}>Delete agent</ConfirmButton>
        </section>
      )}
    </div>
  );
}
