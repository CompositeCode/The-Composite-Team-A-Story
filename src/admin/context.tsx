import { createContext, useContext } from 'react';
import type { GitHub } from './github';
import type { RepoState } from './repo';

export interface AdminCtx {
  gh: GitHub;
  state: RepoState;
  /** Public base URL of the site, for previews and links. */
  base: string;
  reload: () => Promise<void>;
  notify: (message: string, kind?: 'ok' | 'error') => void;
  /** Commit + reload + kick off a Pages rebuild. */
  save: (changes: import('./github').Change[], message: string) => Promise<void>;
  navigate: (hash: string) => void;
}

export const Ctx = createContext<AdminCtx | null>(null);

export function useAdmin(): AdminCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdmin outside provider');
  return ctx;
}
