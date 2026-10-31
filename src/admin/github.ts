// Minimal GitHub REST client for the admin console. Everything runs in the
// browser with the admin's own token; api.github.com supports CORS.

export interface RepoRef {
  owner: string;
  name: string;
  branch: string;
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

/** A file change for `commit()`. `content: null` deletes the path. */
export interface Change {
  path: string;
  content: string | null;
  encoding?: 'utf-8' | 'base64';
}

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const API = 'https://api.github.com';

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHub {
  private blobCache = new Map<string, string>();

  constructor(
    public token: string,
    public repo: RepoRef,
  ) {}

  get slug() {
    return `${this.repo.owner}/${this.repo.name}`;
  }

  async request<T = any>(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<T> {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const err = await res.json();
        message = err.message ?? message;
        if (err.errors?.length) message += `: ${err.errors.map((e: any) => e.message ?? e.code).join(', ')}`;
      } catch {
        /* non-JSON error body */
      }
      throw new GitHubError(res.status, `${method} ${path} → ${res.status} ${message}`);
    }
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('json') ? res.json() : res.text()) as Promise<T>;
  }

  /** Same as request() but follows Link headers for list endpoints (max 10 pages). */
  async paginate<T = any>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = `${API}${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    for (let i = 0; next && i < 10; i++) {
      const res: Response = await fetch(next, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new GitHubError(res.status, `GET ${path} → ${res.status}`);
      const page = await res.json();
      out.push(...(Array.isArray(page) ? page : (page.items ?? [])));
      next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    return out;
  }

  // ---- identity & repo ----------------------------------------------------

  viewer() {
    return this.request<{ login: string; avatar_url: string }>('GET', '/user');
  }

  repoInfo() {
    return this.request<{ full_name: string; permissions?: { push: boolean; admin: boolean }; default_branch: string; private: boolean }>(
      'GET',
      `/repos/${this.slug}`,
    );
  }

  // ---- content --------------------------------------------------------------

  async tree(): Promise<TreeEntry[]> {
    const res = await this.request<{ tree: TreeEntry[]; truncated: boolean }>(
      'GET',
      `/repos/${this.slug}/git/trees/${encodeURIComponent(this.repo.branch)}?recursive=1`,
    );
    return res.tree;
  }

  async blobText(sha: string): Promise<string> {
    const cached = this.blobCache.get(sha);
    if (cached !== undefined) return cached;
    const blob = await this.request<{ content: string; encoding: string }>('GET', `/repos/${this.slug}/git/blobs/${sha}`);
    const text = blob.encoding === 'base64' ? base64ToUtf8(blob.content) : blob.content;
    this.blobCache.set(sha, text);
    return text;
  }

  /** Commits several file changes atomically on the configured branch. */
  async commit(changes: Change[], message: string): Promise<string> {
    if (changes.length === 0) throw new Error('Nothing to commit.');
    for (let attempt = 0; ; attempt++) {
      try {
        const ref = await this.request<{ object: { sha: string } }>('GET', `/repos/${this.slug}/git/ref/heads/${this.repo.branch}`);
        const parent = await this.request<{ tree: { sha: string } }>('GET', `/repos/${this.slug}/git/commits/${ref.object.sha}`);
        const entries = await Promise.all(
          changes.map(async (c) => {
            if (c.content === null) return { path: c.path, mode: '100644', type: 'blob', sha: null };
            const blob = await this.request<{ sha: string }>('POST', `/repos/${this.slug}/git/blobs`, {
              content: c.content,
              encoding: c.encoding ?? 'utf-8',
            });
            return { path: c.path, mode: '100644', type: 'blob', sha: blob.sha };
          }),
        );
        const tree = await this.request<{ sha: string }>('POST', `/repos/${this.slug}/git/trees`, {
          base_tree: parent.tree.sha,
          tree: entries,
        });
        const commit = await this.request<{ sha: string }>('POST', `/repos/${this.slug}/git/commits`, {
          message,
          tree: tree.sha,
          parents: [ref.object.sha],
        });
        await this.request('PATCH', `/repos/${this.slug}/git/refs/heads/${this.repo.branch}`, { sha: commit.sha });
        return commit.sha;
      } catch (e) {
        // The branch moved underneath us (e.g. an agent PR merged); rebuild on the new head once.
        if (attempt === 0 && e instanceof GitHubError && e.status === 422) continue;
        throw e;
      }
    }
  }

  // ---- pull requests (agent posts awaiting review) --------------------------

  openPulls() {
    return this.paginate<any>(`/repos/${this.slug}/pulls?state=open`);
  }
  pullFiles(n: number) {
    return this.paginate<any>(`/repos/${this.slug}/pulls/${n}/files`);
  }
  mergePull(n: number, title: string) {
    return this.request('PUT', `/repos/${this.slug}/pulls/${n}/merge`, { merge_method: 'squash', commit_title: title });
  }
  closePull(n: number) {
    return this.request('PATCH', `/repos/${this.slug}/pulls/${n}`, { state: 'closed' });
  }
  comment(repo: string, n: number, body: string) {
    return this.request('POST', `/repos/${repo}/issues/${n}/comments`, { body });
  }

  // ---- actions ----------------------------------------------------------------

  dispatchWorkflow(file: string) {
    return this.request('POST', `/repos/${this.slug}/actions/workflows/${file}/dispatches`, { ref: this.repo.branch });
  }
  recentRuns() {
    return this.request<{ workflow_runs: any[] }>('GET', `/repos/${this.slug}/actions/runs?per_page=8`);
  }

  // ---- team administration on any repo -----------------------------------------

  collaborators(repo: string) {
    return this.paginate<any>(`/repos/${repo}/collaborators?affiliation=direct`);
  }
  addCollaborator(repo: string, username: string, permission: string) {
    return this.request('PUT', `/repos/${repo}/collaborators/${username}`, { permission });
  }
  removeCollaborator(repo: string, username: string) {
    return this.request('DELETE', `/repos/${repo}/collaborators/${username}`);
  }
  invitations(repo: string) {
    return this.paginate<any>(`/repos/${repo}/invitations`);
  }
  cancelInvitation(repo: string, id: number) {
    return this.request('DELETE', `/repos/${repo}/invitations/${id}`);
  }
  openIssues(repo: string) {
    return this.paginate<any>(`/repos/${repo}/issues?state=open`).then((items) => items.filter((i) => !i.pull_request));
  }
  async ensureLabel(repo: string, name: string) {
    try {
      await this.request('GET', `/repos/${repo}/labels/${encodeURIComponent(name)}`);
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
      await this.request('POST', `/repos/${repo}/labels`, { name, color: '2c5a8a', description: 'Work assigned to a Composite Team agent' });
    }
  }
  addAssignees(repo: string, n: number, assignees: string[]) {
    return this.request('POST', `/repos/${repo}/issues/${n}/assignees`, { assignees });
  }
  removeAssignees(repo: string, n: number, assignees: string[]) {
    return this.request('DELETE', `/repos/${repo}/issues/${n}/assignees`, { assignees });
  }
  addLabels(repo: string, n: number, labels: string[]) {
    return this.request('POST', `/repos/${repo}/issues/${n}/labels`, { labels });
  }
  removeLabel(repo: string, n: number, label: string) {
    return this.request('DELETE', `/repos/${repo}/issues/${n}/labels/${encodeURIComponent(label)}`);
  }
  searchIssues(q: string) {
    return this.request<{ items: any[]; total_count: number }>('GET', `/search/issues?per_page=30&sort=updated&q=${encodeURIComponent(q)}`);
  }
}
