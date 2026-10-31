import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { GitHub, GitHubError, type Change, type RepoRef } from './github';
import { loadRepo, paths, type AdminJson, type RepoState } from './repo';
import { Ctx, type AdminCtx } from './context';
import { Busy, Field } from './ui';
import { hashPassword, json, verifyPassword } from './util';
import Dashboard from './views/Dashboard';
import Agents from './views/Agents';
import Posts from './views/Posts';
import Pending from './views/Pending';
import Story from './views/Story';
import GitHubAdmin from './views/GitHubAdmin';
import Settings from './views/Settings';
import './admin.css';

interface Props {
  admin: AdminJson;
  repo: RepoRef;
  base: string;
}

const KEYS = { unlocked: 'ct-admin-unlocked', token: 'ct-admin-token', repo: 'ct-admin-repo', fails: 'ct-admin-fails' };

const store = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string, persist: boolean) {
    try {
      (persist ? localStorage : sessionStorage).setItem(key, value);
    } catch {
      /* storage blocked: stays in memory for this page view */
    }
  },
  remove(key: string) {
    try {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

function useHash(): [string, (h: string) => void] {
  const [hash, setHash] = useState(() => (typeof location !== 'undefined' ? location.hash.slice(1) || '/' : '/'));
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return [hash, (h: string) => (location.hash = h)];
}

export default function App({ admin: bakedAdmin, repo: bakedRepo, base }: Props) {
  const repo = useMemo<RepoRef>(() => {
    try {
      const override = store.get(KEYS.repo);
      return override ? { ...bakedRepo, ...JSON.parse(override) } : bakedRepo;
    } catch {
      return bakedRepo;
    }
  }, [bakedRepo]);
  const [unlocked, setUnlocked] = useState(() => store.get(KEYS.unlocked) === bakedAdmin.email);
  const [token, setToken] = useState(() => store.get(KEYS.token));

  const lock = () => {
    store.remove(KEYS.unlocked);
    setUnlocked(false);
  };
  const forgetToken = () => {
    store.remove(KEYS.token);
    setToken(null);
  };

  if (!unlocked) return <Login bakedAdmin={bakedAdmin} repo={repo} onUnlock={() => setUnlocked(true)} />;
  if (!token) return <TokenSetup repo={repo} onToken={setToken} onLock={lock} />;
  return <Console token={token} repo={repo} base={base} onLock={lock} onForgetToken={forgetToken} />;
}

// ---- Step 1: email + password ---------------------------------------------------

function Login({ bakedAdmin, repo, onUnlock }: { bakedAdmin: AdminJson; repo: RepoRef; onUnlock: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fails = Number(store.get(KEYS.fails) ?? 0);
    // Back off after repeated failures (cosmetic on a static site, but slows guessing in the UI).
    if (fails > 2) await new Promise((r) => setTimeout(r, Math.min(30, 2 ** (fails - 2)) * 1000));
    // Prefer the latest committed admin.json (a password change may not be deployed yet).
    let admin = bakedAdmin;
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.branch}/${paths.admin}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) admin = await res.json();
    } catch {
      /* offline or private repo: use the copy baked into the build */
    }
    const ok = email.trim().toLowerCase() === admin.email.toLowerCase() && (await verifyPassword(password, admin.passwordHash));
    setBusy(false);
    if (!ok) {
      store.set(KEYS.fails, String(fails + 1), true);
      setError('That email and password combination is not right.');
      return;
    }
    store.remove(KEYS.fails);
    store.set(KEYS.unlocked, admin.email, false);
    onUnlock();
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <h1>Team admin</h1>
        <p className="muted">Sign in to manage the team, the story, and GitHub.</p>
        <Field label="Email">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

// ---- Step 2: GitHub token (the real write permission) ------------------------------

function TokenSetup({ repo, onToken, onLock }: { repo: RepoRef; onToken: (t: string) => void; onLock: () => void }) {
  const [token, setTokenValue] = useState('');
  const [remember, setRemember] = useState(true);
  const [owner, setOwner] = useState(repo.owner);
  const [name, setName] = useState(repo.name);
  const [branch, setBranch] = useState(repo.branch);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const target = { owner: owner.trim(), name: name.trim(), branch: branch.trim() || 'main' };
    try {
      const info = await new GitHub(token.trim(), target).repoInfo();
      if (!info.permissions?.push) throw new Error(`This token can read ${info.full_name} but cannot write to it.`);
      if (target.owner !== repo.owner || target.name !== repo.name || target.branch !== repo.branch) {
        store.set(KEYS.repo, JSON.stringify(target), true);
      }
      store.set(KEYS.token, token.trim(), remember);
      if (target.owner !== repo.owner || target.name !== repo.name) location.reload();
      onToken(token.trim());
    } catch (err) {
      setError(err instanceof GitHubError && err.status === 401 ? 'GitHub rejected that token.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card wide" onSubmit={submit}>
        <h1>Connect GitHub</h1>
        <p className="muted">
          This site is static, so every change you make here is committed to the repository with your own GitHub token. The token is
          kept only in this browser.
        </p>
        <details>
          <summary>What token do I need?</summary>
          <p className="small">
            Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">fine-grained personal access token</a>{' '}
            with access to <strong>{repo.owner}/{repo.name}</strong> and any project repos you manage, with these permissions: <em>Contents</em>, <em>Pull requests</em>,{' '}
            <em>Issues</em> and <em>Actions</em> (read and write), and <em>Administration</em> (read and write, used to manage collaborators). A classic token with the{' '}
            <code>repo</code> and <code>workflow</code> scopes also works.
          </p>
        </details>
        <Field label="GitHub token">
          <input type="password" value={token} onChange={(e) => setTokenValue(e.target.value)} placeholder="github_pat_…" required autoComplete="off" />
        </Field>
        <div className="row">
          <Field label="Owner"><input value={owner} onChange={(e) => setOwner(e.target.value)} required /></Field>
          <Field label="Repository"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Branch"><input value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="row-actions">
          <button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Connect'}</button>
          <button type="button" className="btn ghost" onClick={onLock}>Sign out</button>
        </div>
      </form>
    </div>
  );
}

// ---- Step 3 (first login only): forced password change ---------------------------

function ChangePassword({ gh, state, onDone, forced }: { gh: GitHub; state: RepoState; onDone: () => void; forced?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < 12) return setError('Use at least 12 characters.');
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      if (!(await verifyPassword(current, state.admin.passwordHash))) throw new Error('The current password is not right.');
      const admin: AdminJson = { ...state.admin, passwordHash: await hashPassword(next), mustChangePassword: false };
      await gh.commit([{ path: paths.admin, content: json(admin) }], 'admin: change password');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={forced ? 'auth-card' : 'panel'} onSubmit={submit}>
      <h2>{forced ? 'Choose a new password' : 'Change password'}</h2>
      {forced && <p className="muted">The starter password has to be replaced before you continue.</p>}
      <Field label="Current password"><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
      <Field label="New password" hint="At least 12 characters."><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
      <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
      {error && <p className="error-text">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
    </form>
  );
}
export { ChangePassword };

// ---- The console ------------------------------------------------------------------

const NAV = [
  { hash: '/', label: 'Dashboard' },
  { hash: '/agents', label: 'Agents' },
  { hash: '/posts', label: 'Posts' },
  { hash: '/pending', label: 'Pending' },
  { hash: '/story', label: 'Story' },
  { hash: '/github', label: 'GitHub' },
  { hash: '/settings', label: 'Settings' },
];

function Console({ token, repo, base, onLock, onForgetToken }: {
  token: string;
  repo: RepoRef;
  base: string;
  onLock: () => void;
  onForgetToken: () => void;
}) {
  const gh = useMemo(() => new GitHub(token, repo), [token, repo]);
  const [state, setState] = useState<RepoState | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null);
  const [hash, navigate] = useHash();
  const [viewer, setViewer] = useState<string>('');

  const reload = useCallback(async () => {
    try {
      setState(await loadRepo(gh));
      setError('');
    } catch (e) {
      if (e instanceof GitHubError && e.status === 401) return onForgetToken();
      setError(e instanceof GitHubError && e.status === 409 ? 'The repository is empty. Push the site code first.' : (e as Error).message);
    }
  }, [gh, onForgetToken]);

  useEffect(() => {
    reload();
    gh.viewer().then((v) => setViewer(v.login)).catch(() => {});
  }, [gh, reload]);

  const notify = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), kind === 'error' ? 8000 : 4000);
  }, []);

  const ctx: AdminCtx | null = state && {
    gh,
    state,
    base,
    reload,
    notify,
    navigate,
    save: async (changes: Change[], message: string) => {
      await gh.commit(changes, message);
      await reload();
      notify('Saved. The site rebuilds in a minute or two.');
    },
  };

  if (error) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Can't load the repository</h1>
          <p className="error-text">{error}</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => reload()}>Try again</button>
            <button className="btn ghost" onClick={onForgetToken}>Use a different token</button>
          </div>
        </div>
      </div>
    );
  }
  if (!state || !ctx) return <div className="auth-shell"><Busy label="Loading the repository…" /></div>;
  if (state.admin.mustChangePassword) {
    return (
      <div className="auth-shell">
        <ChangePassword gh={gh} state={state} forced onDone={async () => { await reload(); notify('Password changed.'); }} />
      </div>
    );
  }

  const route = hash.split('?')[0];
  const section = '/' + (route.split('/')[1] ?? '');
  const sub = route.split('/').slice(2).filter(Boolean).map(decodeURIComponent);
  const pendingCount = state.posts.filter((p) => p.data.status === 'draft').length;

  return (
    <Ctx.Provider value={ctx}>
      <div className="console">
        <aside className="sidebar">
          <a className="side-brand" href={base}>{state.site.title}</a>
          <nav>
            {NAV.map((n) => (
              <a key={n.hash} href={`#${n.hash}`} className={section === n.hash ? 'on' : ''}>
                {n.label}
                {n.hash === '/posts' && pendingCount > 0 && <span className="count">{pendingCount}</span>}
              </a>
            ))}
          </nav>
          <div className="side-foot">
            <div className="small muted">{gh.slug}@{repo.branch}{viewer && <><br />as {viewer}</>}</div>
            <button className="btn ghost small" onClick={() => reload().then(() => notify('Reloaded from GitHub.'))}>Reload</button>
            <button className="btn ghost small" onClick={onLock}>Sign out</button>
          </div>
        </aside>
        <main className="content">
          {section === '/' && <Dashboard />}
          {section === '/agents' && <Agents sub={sub} />}
          {section === '/posts' && <Posts sub={sub} />}
          {section === '/pending' && <Pending />}
          {section === '/story' && <Story sub={sub} />}
          {section === '/github' && <GitHubAdmin sub={sub} />}
          {section === '/settings' && <Settings onForgetToken={onForgetToken} ChangePassword={ChangePassword} />}
        </main>
        {toast && <div className={`toast ${toast.kind}`} role="status">{toast.message}</div>}
      </div>
    </Ctx.Provider>
  );
}
