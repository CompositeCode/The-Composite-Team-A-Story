import { useState, type ComponentType } from 'react';
import { useAdmin } from '../context';
import type { GitHub } from '../github';
import { paths, type RepoState, type SiteJson } from '../repo';
import { Field } from '../ui';
import { json } from '../util';

interface Props {
  onForgetToken: () => void;
  ChangePassword: ComponentType<{ gh: GitHub; state: RepoState; onDone: () => void }>;
}

export default function Settings({ onForgetToken, ChangePassword }: Props) {
  const { gh, state, save, reload, notify } = useAdmin();
  const [site, setSite] = useState<SiteJson>(state.site);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SiteJson>(k: K, v: SiteJson[K]) => setSite((s) => ({ ...s, [k]: v }));

  async function submit() {
    setBusy(true);
    try {
      await save([{ path: paths.site, content: json(site) }], 'admin: update site settings');
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Settings</h1>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save site settings'}</button>
      </header>
      <section className="panel">
        <h2>Site</h2>
        <Field label="Title"><input value={site.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Tagline"><input value={site.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
        <Field label="About" hint="Shown at the top of the home page."><textarea rows={4} value={site.about} onChange={(e) => set('about', e.target.value)} /></Field>
        <Field label="GitHub organization URL"><input value={site.github?.orgUrl ?? ''} onChange={(e) => set('github', { orgUrl: e.target.value })} /></Field>
        <div className="row">
          <Field label="Content repo owner"><input value={site.repo.owner} onChange={(e) => set('repo', { ...site.repo, owner: e.target.value })} /></Field>
          <Field label="Content repo name"><input value={site.repo.name} onChange={(e) => set('repo', { ...site.repo, name: e.target.value })} /></Field>
          <Field label="Branch"><input value={site.repo.branch} onChange={(e) => set('repo', { ...site.repo, branch: e.target.value })} /></Field>
        </div>
      </section>

      <ChangePassword gh={gh} state={state} onDone={async () => { await reload(); notify('Password changed.'); }} />

      <section className="panel">
        <h2>GitHub token</h2>
        <p className="small">
          The admin console writes to <strong>{gh.slug}</strong> with the token stored in this browser. Remove it here when you're done on a shared machine.
        </p>
        <button className="btn" onClick={onForgetToken}>Forget token on this device</button>
      </section>

      <section className="panel">
        <h2>How security works here</h2>
        <p className="small">
          GitHub Pages only serves static files, so the email and password screen is a convenience lock and not a server-side check. Its hash is
          published along with the site. What actually protects the content is GitHub: nothing changes unless a token with write access to the repository makes the
          commit. Keep that token fine-grained, scoped to these repositories, and set to expire.
        </p>
      </section>
    </div>
  );
}
