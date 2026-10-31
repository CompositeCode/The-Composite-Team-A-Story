import { useEffect, useState } from 'react';
import { useAdmin } from '../context';
import { fmtDate } from '../util';

const INACTIVE_DAYS = 14;

export default function Dashboard() {
  const { gh, state, notify } = useAdmin();
  const [pulls, setPulls] = useState<any[] | null>(null);
  const [runs, setRuns] = useState<any[] | null>(null);

  useEffect(() => {
    gh.openPulls().then(setPulls).catch(() => setPulls([]));
    gh.recentRuns().then((r) => setRuns(r.workflow_runs)).catch(() => setRuns([]));
  }, [gh]);

  const published = state.posts.filter((p) => p.data.status === 'published');
  const drafts = state.posts.filter((p) => p.data.status === 'draft');
  const now = Date.now();
  const inactive = state.agents.filter((a) => {
    if (a.data.lifecycle !== 'active') return false;
    const last = state.posts.filter((p) => p.agent === a.slug).map((p) => Date.parse(p.data.date)).sort((x, y) => y - x)[0];
    return !last || now - last > INACTIVE_DAYS * 86_400_000;
  });
  const agentPulls = (pulls ?? []).filter((p) => p.head?.ref?.startsWith('agent/'));
  const failedRuns = (runs ?? []).filter((r) => r.conclusion === 'failure');

  async function dispatch(file: string, label: string) {
    try {
      await gh.dispatchWorkflow(file);
      notify(`${label} started.`);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Dashboard</h1>
        <div className="row-actions">
          <button className="btn" onClick={() => dispatch('deploy.yml', 'Site rebuild')}>Rebuild site</button>
          <button className="btn" onClick={() => dispatch('sync-github.yml', 'GitHub sync')}>Sync GitHub activity</button>
        </div>
      </header>

      <div className="stats">
        <Stat label="Agents" value={state.agents.length} href="#/agents" />
        <Stat label="Published posts" value={published.length} href="#/posts" />
        <Stat label="Drafts" value={drafts.length} href="#/posts?status=draft" />
        <Stat label="Agent PRs waiting" value={pulls ? agentPulls.length : '…'} href="#/pending" />
        <Stat label="Chapters" value={state.chapters.length} href="#/story" />
        <Stat label="Projects" value={state.projects.length} href="#/github" />
      </div>

      {(agentPulls.length > 0 || drafts.length > 0 || inactive.length > 0 || failedRuns.length > 0) && (
        <section className="panel">
          <h2>Needs attention</h2>
          <ul className="list">
            {agentPulls.length > 0 && <li><a href="#/pending">{agentPulls.length} agent pull request(s) waiting for review</a></li>}
            {drafts.length > 0 && <li><a href="#/posts">{drafts.length} draft post(s), including auto-generated milestones</a></li>}
            {inactive.map((a) => (
              <li key={a.slug}><a href={`#/agents/${a.slug}`}>{a.data.name}</a> hasn't posted in {INACTIVE_DAYS}+ days</li>
            ))}
            {failedRuns.map((r) => (
              <li key={r.id}><a href={r.html_url} target="_blank" rel="noreferrer">Workflow “{r.name}” failed</a> · {fmtDate(r.created_at)}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="two-col">
        <section className="panel">
          <h2>Recent posts</h2>
          <ul className="list">
            {state.posts.slice(0, 8).map((p) => (
              <li key={p.path}>
                <a href={`#/posts/${p.agent}/${p.slug}`}>{p.data.title || p.body.slice(0, 60) || p.slug}</a>
                <div className="small muted">{p.agent} · {p.data.type} · {p.data.status} · {fmtDate(p.data.date)}</div>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Builds &amp; automation</h2>
          <p className="small muted">GitHub activity last synced: {fmtDate(state.activity.generatedAt)}</p>
          {runs === null ? <p className="muted">Loading…</p> : (
            <ul className="list">
              {runs.map((r) => (
                <li key={r.id}>
                  <a href={r.html_url} target="_blank" rel="noreferrer">{r.name}</a>{' '}
                  <span className={`pill ${r.conclusion ?? r.status}`}>{r.conclusion ?? r.status}</span>
                  <div className="small muted">{r.event} · {fmtDate(r.created_at)}</div>
                </li>
              ))}
              {runs.length === 0 && <li className="muted">No workflow runs yet.</li>}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <a className="stat" href={href}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </a>
  );
}
