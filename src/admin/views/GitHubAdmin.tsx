import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../context';
import { paths, type Project } from '../repo';
import { Busy, ConfirmButton, Empty, Field } from '../ui';
import { fmtDate, json } from '../util';

const PERMISSIONS = ['pull', 'triage', 'push', 'maintain'] as const;
const PERMISSION_LABEL: Record<string, string> = { pull: 'read', triage: 'triage', push: 'write', maintain: 'maintain', admin: 'admin' };
const ROLES = ['maintainer', 'contributor', 'reviewer'];

export default function GitHubAdmin({ sub }: { sub: string[] }) {
  const { state } = useAdmin();
  if (sub[0] === 'activity') return <AgentActivity />;
  if (sub[0] === 'new') return <ProjectEditor key="new" />;
  if (sub[0] && sub[1]) {
    const project = state.projects.find((p) => p.id === `${sub[0]}/${sub[1]}`);
    return project ? <ProjectDetail key={project.id} project={project} /> : <Empty>Unknown project.</Empty>;
  }
  return (
    <div className="stack">
      <header className="page-head">
        <h1>GitHub</h1>
        <div className="row-actions">
          <a className="btn" href="#/github/activity">Agent activity</a>
          <a className="btn primary" href="#/github/new">Add project</a>
        </div>
      </header>
      <p className="muted">Projects are the repositories the team works on. Open one to manage the agents' access, assign issues to them, and set their roles.</p>
      {state.projects.length === 0 && <Empty>No projects yet.</Empty>}
      <div className="agent-grid">
        {state.projects.map((p) => (
          <a key={p.id} className="panel" href={`#/github/${p.id}`}>
            <strong>{p.displayName}</strong>
            <div className="small muted">{p.id} {!p.public && <span className="pill">hidden from site</span>}</div>
            <div className="small">{p.agents.map((a) => `${a.slug} (${a.role})`).join(', ') || 'No agents assigned'}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

function ProjectEditor({ project, onSaved }: { project?: Project; onSaved?: () => void }) {
  const { state, save, navigate, notify } = useAdmin();
  const [repo, setRepo] = useState(project?.id ?? '');
  const [displayName, setDisplayName] = useState(project?.displayName ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [isPublic, setPublic] = useState(project?.public ?? true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const m = repo.trim().replace(/^https:\/\/github\.com\//, '').match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!m) return notify('Use the form owner/repo.', 'error');
    const id = `${m[1]}/${m[2]}`;
    if (!project && state.projects.some((p) => p.id.toLowerCase() === id.toLowerCase())) return notify('That project is already listed.', 'error');
    const next: Project = { id, owner: m[1], repo: m[2], displayName: displayName.trim() || m[2], description: description.trim(), public: isPublic, agents: project?.agents ?? [] };
    const projects = project ? state.projects.map((p) => (p.id === project.id ? next : p)) : [...state.projects, next];
    setBusy(true);
    try {
      await save([{ path: paths.projects, content: json(projects) }], `admin: ${project ? 'update' : 'add'} project ${id}`);
      onSaved ? onSaved() : navigate(`/github/${id}`);
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      {!project && <><a href="#/github" className="small">← GitHub</a><h1>Add project</h1></>}
      <div className="row">
        <Field label="Repository" hint="owner/repo"><input value={repo} disabled={!!project} onChange={(e) => setRepo(e.target.value)} /></Field>
        <Field label="Display name"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
      </div>
      <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} /> Show on the public Projects page</label>
      <div className="row-actions" style={{ marginTop: '1rem' }}>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save project'}</button>
      </div>
    </section>
  );
}

function ProjectDetail({ project }: { project: Project }) {
  const { state, save, navigate, notify } = useAdmin();
  const [tab, setTab] = useState<'team' | 'access' | 'issues' | 'settings'>('team');
  const repo = project.id;

  async function saveAssignments(agents: Project['agents']) {
    const projects = state.projects.map((p) => (p.id === project.id ? { ...p, agents } : p));
    try {
      await save([{ path: paths.projects, content: json(projects) }], `admin: update team on ${repo}`);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  async function removeProject() {
    try {
      await save([{ path: paths.projects, content: json(state.projects.filter((p) => p.id !== project.id)) }], `admin: remove project ${repo}`);
      navigate('/github');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  const unassigned = state.agents.filter((a) => !project.agents.some((pa) => pa.slug === a.slug));

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <a href="#/github" className="small">← GitHub</a>
          <h1>{project.displayName}</h1>
          <a className="small" href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">{repo}</a>
        </div>
      </header>
      <div className="tabs big">
        {(['team', 'access', 'issues', 'settings'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ team: 'Team', access: 'Access', issues: 'Issues', settings: 'Settings' }[t]}</button>
        ))}
      </div>

      {tab === 'team' && (
        <section className="panel">
          <h2>Agents on this project</h2>
          <table className="table">
            <tbody>
              {project.agents.map((pa) => {
                const agent = state.agents.find((a) => a.slug === pa.slug);
                return (
                  <tr key={pa.slug}>
                    <td><a href={`#/agents/${pa.slug}`}>{agent?.data.name ?? pa.slug}</a></td>
                    <td>
                      <select value={pa.role} onChange={(e) => saveAssignments(project.agents.map((x) => (x.slug === pa.slug ? { ...x, role: e.target.value } : x)))}>
                        {[...new Set([...ROLES, pa.role])].map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td><button className="btn ghost small" onClick={() => saveAssignments(project.agents.filter((x) => x.slug !== pa.slug))}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {project.agents.length === 0 && <p className="muted">No agents yet.</p>}
          {unassigned.length > 0 && (
            <AddAssignment agents={unassigned.map((a) => ({ slug: a.slug, name: a.data.name }))} onAdd={(slug, role) => saveAssignments([...project.agents, { slug, role }])} />
          )}
          <p className="field-hint">Roles show on the public site. To give an agent access to the repository itself, use the Access tab.</p>
        </section>
      )}
      {tab === 'access' && <Access repo={repo} />}
      {tab === 'issues' && <Issues repo={repo} project={project} />}
      {tab === 'settings' && (
        <>
          <ProjectEditor project={project} onSaved={() => notify('Project saved.')} />
          <section className="panel danger-zone">
            <p className="small">Removing a project only takes it off this site. The GitHub repository is not touched.</p>
            <ConfirmButton onConfirm={removeProject}>Remove project</ConfirmButton>
          </section>
        </>
      )}
    </div>
  );
}

function AddAssignment({ agents, onAdd }: { agents: { slug: string; name: string }[]; onAdd: (slug: string, role: string) => void }) {
  const [slug, setSlug] = useState(agents[0]?.slug ?? '');
  const [role, setRole] = useState('contributor');
  return (
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <Field label="Agent">
        <select value={slug} onChange={(e) => setSlug(e.target.value)}>{agents.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select>
      </Field>
      <Field label="Role">
        <select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
      </Field>
      <button className="btn" onClick={() => slug && onAdd(slug, role)}>Add to project</button>
    </div>
  );
}

function Access({ repo }: { repo: string }) {
  const { gh, state, notify } = useAdmin();
  const [collabs, setCollabs] = useState<any[] | null>(null);
  const [invites, setInvites] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [who, setWho] = useState('');
  const [perm, setPerm] = useState<string>('push');

  const load = useCallback(async () => {
    try {
      const [c, i] = await Promise.all([gh.collaborators(repo), gh.invitations(repo)]);
      setCollabs(c);
      setInvites(i);
      setError('');
    } catch (e) {
      setError((e as Error).message);
      setCollabs([]);
    }
  }, [gh, repo]);
  useEffect(() => { load(); }, [load]);

  const agentLogins = new Map(state.agents.filter((a) => a.data.githubUsername).map((a) => [a.data.githubUsername!.toLowerCase(), a]));

  async function grant(username: string, permission: string) {
    try {
      await gh.addCollaborator(repo, username, permission);
      notify(`Granted ${PERMISSION_LABEL[permission]} access to ${username}. New collaborators get an invitation.`);
      await load();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  async function revoke(username: string) {
    try {
      await gh.removeCollaborator(repo, username);
      notify(`Removed ${username}.`);
      await load();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  if (!collabs) return <Busy />;
  const agentsWithout = state.agents.filter((a) => a.data.githubUsername && !collabs.some((c) => c.login.toLowerCase() === a.data.githubUsername!.toLowerCase()) && !invites.some((i) => i.invitee?.login?.toLowerCase() === a.data.githubUsername!.toLowerCase()));

  return (
    <section className="panel">
      <h2>Repository access</h2>
      {error && <p className="error-text">{error} (managing collaborators needs a token with Administration permission on {repo})</p>}
      <table className="table">
        <thead><tr><th>Collaborator</th><th>Agent</th><th>Permission</th><th /></tr></thead>
        <tbody>
          {collabs.map((c) => {
            const agent = agentLogins.get(c.login.toLowerCase());
            return (
              <tr key={c.id}>
                <td><a href={c.html_url} target="_blank" rel="noreferrer">{c.login}</a></td>
                <td>{agent ? <a href={`#/agents/${agent.slug}`}>{agent.data.name}</a> : <span className="muted">—</span>}</td>
                <td>
                  <select value={c.role_name === 'write' ? 'push' : c.role_name === 'read' ? 'pull' : c.role_name} onChange={(e) => grant(c.login, e.target.value)} disabled={c.role_name === 'admin'}>
                    {[...PERMISSIONS, ...(c.role_name === 'admin' ? ['admin'] : [])].map((p) => <option key={p} value={p}>{PERMISSION_LABEL[p]}</option>)}
                  </select>
                </td>
                <td>{agent && <ConfirmButton className="btn ghost small" onConfirm={() => revoke(c.login)}>Remove</ConfirmButton>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {invites.length > 0 && (
        <>
          <h3>Pending invitations</h3>
          <ul className="list">
            {invites.map((i) => (
              <li key={i.id}>
                {i.invitee?.login} · {i.permissions} · sent {fmtDate(i.created_at)}{' '}
                <button className="btn ghost small" onClick={async () => { await gh.cancelInvitation(repo, i.id).catch((e) => notify(e.message, 'error')); load(); }}>Cancel</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Grant access</h3>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="Agent's GitHub account">
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose…</option>
            {agentsWithout.map((a) => <option key={a.slug} value={a.data.githubUsername}>{a.data.name} (@{a.data.githubUsername})</option>)}
          </select>
        </Field>
        <Field label="Permission">
          <select value={perm} onChange={(e) => setPerm(e.target.value)}>{PERMISSIONS.map((p) => <option key={p} value={p}>{PERMISSION_LABEL[p]}</option>)}</select>
        </Field>
        <button className="btn primary" disabled={!who} onClick={() => grant(who, perm)}>Grant</button>
      </div>
      <p className="field-hint">Only agents with a GitHub username on their profile can be added here.</p>
    </section>
  );
}

function Issues({ repo, project }: { repo: string; project: Project }) {
  const { gh, state, notify } = useAdmin();
  const [issues, setIssues] = useState<any[] | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => gh.openIssues(repo).then(setIssues).catch((e) => { notify(e.message, 'error'); setIssues([]); }), [gh, repo, notify]);
  useEffect(() => { load(); }, [load]);

  // Agents on this project first, then everyone else.
  const onProject = (slug: string) => project.agents.some((pa) => pa.slug === slug);
  const teamAgents = [...state.agents].sort((a, b) => Number(onProject(b.slug)) - Number(onProject(a.slug)));

  async function assign(issue: any, slug: string) {
    const agent = state.agents.find((a) => a.slug === slug);
    if (!agent) return;
    const label = `agent:${slug}`;
    try {
      await gh.ensureLabel(repo, label);
      await gh.addLabels(repo, issue.number, [label]);
      if (agent.data.githubUsername) await gh.addAssignees(repo, issue.number, [agent.data.githubUsername]);
      notify(`Assigned #${issue.number} to ${agent.data.name}.`);
      await load();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  async function unassign(issue: any, slug: string) {
    const agent = state.agents.find((a) => a.slug === slug);
    try {
      await gh.removeLabel(repo, issue.number, `agent:${slug}`).catch(() => {});
      if (agent?.data.githubUsername) await gh.removeAssignees(repo, issue.number, [agent.data.githubUsername]);
      notify(`Unassigned #${issue.number}.`);
      await load();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }

  if (!issues) return <Busy label="Loading issues…" />;
  const shown = issues.filter((i) => !filter || i.title.toLowerCase().includes(filter.toLowerCase()) || String(i.number) === filter);
  return (
    <section className="panel">
      <div className="page-head">
        <h2 style={{ margin: 0 }}>Open issues</h2>
        <input type="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p className="field-hint">Assigning adds an <code>agent:&lt;slug&gt;</code> label, and also adds the agent's GitHub account as an assignee when it has one. The label works even when agents share one GitHub identity.</p>
      {shown.length === 0 && <Empty>No open issues.</Empty>}
      <table className="table">
        <tbody>
          {shown.map((issue) => {
            const assigned = (issue.labels ?? []).map((l: any) => l.name).filter((n: string) => n.startsWith('agent:')).map((n: string) => n.slice(6));
            return (
              <tr key={issue.id}>
                <td className="nowrap">#{issue.number}</td>
                <td>
                  <a href={issue.html_url} target="_blank" rel="noreferrer">{issue.title}</a>
                  <div className="small muted">{issue.assignees?.map((a: any) => a.login).join(', ') || 'unassigned'} · updated {fmtDate(issue.updated_at)}</div>
                </td>
                <td>
                  {assigned.map((slug: string) => (
                    <span key={slug} className="pill accent">{slug} <button className="x" aria-label={`Unassign ${slug}`} onClick={() => unassign(issue, slug)}>×</button></span>
                  ))}
                </td>
                <td>
                  <select value="" onChange={(e) => e.target.value && assign(issue, e.target.value)}>
                    <option value="">Assign agent…</option>
                    {teamAgents.filter((a) => !assigned.includes(a.slug)).map((a) => <option key={a.slug} value={a.slug}>{a.data.name}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function AgentActivity() {
  const { gh, state } = useAdmin();
  const [slug, setSlug] = useState(state.agents[0]?.slug ?? '');
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const agent = state.agents.find((a) => a.slug === slug);

  useEffect(() => {
    if (!agent) return;
    setItems(null);
    setError('');
    const repos = state.projects.map((p) => `repo:${p.id}`).join(' ');
    const who = agent.data.githubUsername ? `involves:${agent.data.githubUsername}` : `label:agent:${agent.slug}`;
    gh.searchIssues(`${who} ${repos}`.trim())
      .then((r) => setItems(r.items))
      .catch((e) => { setError(e.message); setItems([]); });
  }, [gh, agent, state.projects]);

  return (
    <div className="stack">
      <header className="page-head">
        <div><a href="#/github" className="small">← GitHub</a><h1>Agent activity</h1></div>
        <select value={slug} onChange={(e) => setSlug(e.target.value)}>
          {state.agents.map((a) => <option key={a.slug} value={a.slug}>{a.data.name}</option>)}
        </select>
      </header>
      <p className="muted small">
        Issues and pull requests across the team's projects {agent?.data.githubUsername ? <>involving <strong>@{agent.data.githubUsername}</strong></> : <>labelled <code>agent:{slug}</code></>}, most recently updated first.
      </p>
      {error && <p className="error-text">{error}</p>}
      {!items ? <Busy /> : items.length === 0 ? <Empty>No activity found.</Empty> : (
        <table className="table">
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td><span className={`pill ${i.pull_request ? (i.pull_request.merged_at ? 'merged' : i.state) : i.state}`}>{i.pull_request ? (i.pull_request.merged_at ? 'merged PR' : `${i.state} PR`) : `${i.state} issue`}</span></td>
                <td><a href={i.html_url} target="_blank" rel="noreferrer">{i.title}</a><div className="small muted">{i.repository_url.replace('https://api.github.com/repos/', '')} #{i.number}</div></td>
                <td className="small nowrap">{fmtDate(i.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
