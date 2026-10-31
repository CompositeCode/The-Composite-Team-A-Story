import { useState } from 'react';
import { useAdmin } from '../context';
import type { Change } from '../github';
import { mediaRef, mediaRepoPath, paths, type ChapterRecord } from '../repo';
import { ConfirmButton, Empty, Field, ImagePicker, MarkdownEditor, type PendingUpload } from '../ui';
import { fmtDate, fromLocalInput, randomId, slugify, stringifyMd, toLocalInput } from '../util';

export default function Story({ sub }: { sub: string[] }) {
  const { state } = useAdmin();
  if (sub[0] === 'new') return <ChapterEditor key="new" />;
  if (sub[0]) {
    const chapter = state.chapters.find((c) => c.file === sub[0]);
    return chapter ? <ChapterEditor key={chapter.file} chapter={chapter} /> : <Empty>No such chapter.</Empty>;
  }
  return (
    <div className="stack">
      <header className="page-head">
        <h1>Story</h1>
        <a className="btn primary" href="#/story/new">New chapter</a>
      </header>
      <p className="muted">Chapters are the narrative that ties the agents' walls together. Mention an agent with <code>@slug</code>, and embed one of their posts with <code>[[post:slug/post-slug]]</code> on a line of its own.</p>
      {state.chapters.length === 0 && <Empty>No chapters yet.</Empty>}
      <table className="table">
        <tbody>
          {state.chapters.map((c) => (
            <tr key={c.path}>
              <td className="nowrap">Chapter {c.data.number}</td>
              <td><a href={`#/story/${c.file}`}>{c.data.title}</a></td>
              <td><span className={`pill ${c.data.status}`}>{c.data.status}</span></td>
              <td className="small nowrap">{fmtDate(c.data.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChapterEditor({ chapter }: { chapter?: ChapterRecord }) {
  const { state, base, save, navigate, notify } = useAdmin();
  const isNew = !chapter;
  const nextNumber = Math.max(-1, ...state.chapters.map((c) => c.data.number)) + 1;
  const [data, setData] = useState<ChapterRecord['data']>(() => chapter?.data ?? { number: nextNumber, title: '', date: new Date().toISOString(), status: 'draft' });
  const [body, setBody] = useState(chapter?.body ?? '');
  const [cover, setCover] = useState<PendingUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ChapterRecord['data']>(k: K, v: ChapterRecord['data'][K]) => setData((d) => ({ ...d, [k]: v }));

  async function submit() {
    if (!data.title.trim()) return notify('Give the chapter a title.', 'error');
    // The URL slug comes from the file name minus its number prefix, so it stays stable when renumbering.
    const file = chapter?.file ?? `${String(data.number).padStart(2, '0')}-${slugify(data.title)}`;
    if (isNew && state.chapters.some((c) => c.file.replace(/^\d+-/, '') === file.replace(/^\d+-/, ''))) {
      return notify('A chapter with that title already exists.', 'error');
    }
    const changes: Change[] = [];
    const next = { ...data, title: data.title.trim() };
    if (cover) {
      const path = `${paths.storyMedia}/${file}-${randomId(4)}.${cover.ext}`;
      changes.push({ path, content: cover.base64, encoding: 'base64' });
      if (chapter?.data.cover) changes.push({ path: mediaRepoPath(chapter.data.cover), content: null });
      next.cover = mediaRef(path);
    }
    changes.push({ path: paths.chapter(file), content: stringifyMd(next, body) });
    setBusy(true);
    try {
      await save(changes, `admin: ${isNew ? 'add' : 'update'} chapter ${data.number}: ${next.title}`);
      if (isNew) navigate(`/story/${file}`);
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await save([{ path: chapter!.path, content: null }], `admin: delete chapter ${chapter!.data.number}`);
      navigate('/story');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <a href="#/story" className="small">← Story</a>
          <h1>{isNew ? 'New chapter' : `Chapter ${data.number}`}</h1>
        </div>
        <div className="row-actions">
          {!isNew && data.status === 'published' && <a className="btn ghost" href={`${base}story/${chapter!.file.replace(/^\d+-/, '')}/`} target="_blank" rel="noreferrer">View</a>}
          <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </header>
      <section className="panel">
        <div className="row">
          <Field label="Number"><input type="number" value={data.number} onChange={(e) => set('number', Number(e.target.value))} /></Field>
          <Field label="Status">
            <select value={data.status} onChange={(e) => set('status', e.target.value as 'published' | 'draft')}>
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </Field>
          <Field label="Date"><input type="datetime-local" value={toLocalInput(data.date)} onChange={(e) => e.target.value && set('date', fromLocalInput(e.target.value))} /></Field>
        </div>
        <Field label="Title"><input value={data.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Summary" hint="One or two sentences, shown on cards and in feeds."><input value={data.summary ?? ''} onChange={(e) => set('summary', e.target.value || undefined)} /></Field>
        <div className="field-label">Cover</div>
        {(cover?.previewUrl || data.cover) && <img className="banner-preview" src={cover?.previewUrl ?? `${base}${data.cover}`} alt="" />}
        <ImagePicker mode="fit" onPicked={([f]) => setCover(f)} label={data.cover || cover ? 'Replace cover' : 'Upload cover'} />
        <Field label="Chapter"><MarkdownEditor value={body} onChange={setBody} base={base} rows={22} /></Field>
      </section>
      {!isNew && (
        <section className="panel danger-zone">
          <ConfirmButton onConfirm={remove}>Delete chapter</ConfirmButton>
        </section>
      )}
    </div>
  );
}
