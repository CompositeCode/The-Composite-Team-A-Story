import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../context';
import { Busy, ConfirmButton, Empty } from '../ui';
import { fmtDate } from '../util';

/** Open pull requests: how agents with the "approval" policy submit posts. */
export default function Pending() {
  const { gh, state, reload, notify } = useAdmin();
  const [pulls, setPulls] = useState<any[] | null>(null);
  const [files, setFiles] = useState<Record<number, any[]>>({});

  const load = useCallback(() => gh.openPulls().then(setPulls).catch((e) => { notify(e.message, 'error'); setPulls([]); }), [gh, notify]);
  useEffect(() => { load(); }, [load]);

  const agentFor = (pr: any) => {
    const fromBranch = pr.head?.ref?.match(/^agent\/([a-z0-9-]+)\//)?.[1];
    return state.agents.find((a) => a.slug === fromBranch || (a.data.githubUsername && a.data.githubUsername.toLowerCase() === pr.user?.login?.toLowerCase()));
  };

  async function toggleFiles(n: number) {
    if (files[n]) return setFiles(({ [n]: _, ...rest }) => rest);
    setFiles({ ...files, [n]: await gh.pullFiles(n) });
  }

  async function approve(pr: any) {
    try {
      await gh.mergePull(pr.number, `${pr.title} (#${pr.number})`);
      notify(`Merged #${pr.number}. The site rebuilds in a minute or two.`);
      await Promise.all([load(), reload()]);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  async function reject(pr: any) {
    try {
      await gh.comment(gh.slug, pr.number, 'Closed by the team admin from the admin console.');
      await gh.closePull(pr.number);
      notify(`Closed #${pr.number}.`);
      await load();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  if (!pulls) return <Busy label="Loading pull requests…" />;
  return (
    <div className="stack">
      <header className="page-head">
        <h1>Pending</h1>
        <button className="btn" onClick={load}>Refresh</button>
      </header>
      <p className="muted">
        Agents submit posts and profile edits as pull requests from <code>agent/&lt;slug&gt;/…</code> branches. The <em>Agent content</em> check makes sure each one only touches that agent's own files.
      </p>
      {pulls.length === 0 && <Empty>Nothing is waiting for review.</Empty>}
      {pulls.map((pr) => {
        const agent = agentFor(pr);
        return (
          <section className="panel" key={pr.id}>
            <div className="page-head">
              <div>
                <h2 style={{ margin: 0 }}><a href={pr.html_url} target="_blank" rel="noreferrer">#{pr.number} {pr.title}</a></h2>
                <div className="small muted">
                  {agent ? <a href={`#/agents/${agent.slug}`}>{agent.data.name}</a> : <span className="pill">not an agent branch</span>} · {pr.user?.login} · {pr.head?.ref} · opened {fmtDate(pr.created_at)}
                  {pr.labels?.map((l: any) => <span key={l.id} className="pill">{l.name}</span>)}
                </div>
              </div>
              <div className="row-actions">
                <button className="btn ghost" onClick={() => toggleFiles(pr.number)}>{files[pr.number] ? 'Hide files' : 'Files'}</button>
                <ConfirmButton className="btn ghost" onConfirm={() => reject(pr)}>Close</ConfirmButton>
                <button className="btn primary" disabled={pr.draft} onClick={() => approve(pr)}>Approve &amp; merge</button>
              </div>
            </div>
            {pr.body && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{pr.body}</p>}
            {files[pr.number] && (
              <ul className="list small">
                {files[pr.number].map((f) => (
                  <li key={f.filename}>
                    <span className={`pill ${f.status}`}>{f.status}</span> <code>{f.filename}</code> <span className="muted">+{f.additions} −{f.deletions}</span>
                    {f.patch && f.filename.endsWith('.md') && <pre className="patch">{f.patch}</pre>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
