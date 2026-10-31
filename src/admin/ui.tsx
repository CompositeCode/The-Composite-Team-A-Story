import { useMemo, useRef, useState, type ReactNode } from 'react';
import { processImage, renderPreview, type ImageMode, type ProcessedImage } from './util';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Busy({ label = 'Working…' }: { label?: string }) {
  return (
    <div className="busy" role="status">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

/** Two-step button instead of window.confirm(). */
export function ConfirmButton({ onConfirm, children, className = 'btn danger', disabled }: {
  onConfirm: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="confirm">
      <button type="button" className={className} disabled={disabled} onClick={() => { setArmed(false); onConfirm(); }}>
        Yes, {typeof children === 'string' ? children.toLowerCase() : 'confirm'}
      </button>
      <button type="button" className="btn ghost" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  ) : (
    <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>{children}</button>
  );
}

export function MarkdownEditor({ value, onChange, base, rows = 14, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  base: string;
  rows?: number;
  placeholder?: string;
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const html = useMemo(() => (tab === 'preview' ? renderPreview(value, base) : ''), [tab, value, base]);
  return (
    <div className="md-editor">
      <div className="tabs">
        <button type="button" className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>Write</button>
        <button type="button" className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>Preview</button>
        <span className="field-hint" style={{ marginLeft: 'auto' }}>Markdown · <code>@slug</code> mentions · <code>[[post:agent/post-slug]]</code> embeds</span>
      </div>
      {tab === 'write' ? (
        <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="preview prose" dangerouslySetInnerHTML={{ __html: html || '<p class="muted">Nothing to preview.</p>' }} />
      )}
    </div>
  );
}

/** A file picked in the browser, processed and waiting to be committed. */
export interface PendingUpload extends ProcessedImage {
  name: string;
}

export function ImagePicker({ mode, multiple, onPicked, label = 'Upload image' }: {
  mode: ImageMode;
  multiple?: boolean;
  onPicked: (files: PendingUpload[]) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function handle(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      const out: PendingUpload[] = [];
      for (const f of Array.from(files)) out.push({ ...(await processImage(f, mode)), name: f.name });
      onPicked(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <span className="image-picker">
      <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Processing…' : label}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple={multiple} hidden onChange={(e) => handle(e.target.files)} />
      {error && <span className="error-text">{error}</span>}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
