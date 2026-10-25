import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { overwriteLatest, reloadLatest } from '../hooks/useAutosave';
import { useCanvasStore } from '../store/canvasStore';

/** Shown under the top bar for save conflicts and failures (ARCHITECTURE.md §8.5) */
export function SaveBanner() {
  const saveState = useCanvasStore((s) => s.saveState);
  const saveError = useCanvasStore((s) => s.saveError);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = (action: () => Promise<void>) => async () => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (saveState === 'conflict') {
    return (
      <Banner tone="warning">
        <span className="flex-1">
          Someone else saved this canvas since you loaded it. Your latest changes are not saved.
          {failed && <span className="text-danger"> That did not work; try again.</span>}
        </span>
        <BannerButton disabled={busy} onClick={run(reloadLatest)}>
          Reload latest
        </BannerButton>
        <BannerButton disabled={busy} onClick={run(overwriteLatest)}>
          Overwrite with mine
        </BannerButton>
      </Banner>
    );
  }

  if (saveState === 'error' && saveError?.kind === 'invalid') {
    const [first, ...rest] = saveError.issues;
    return (
      <Banner tone="danger">
        <span>
          Not saved: {first?.message ?? 'the canvas is invalid'}
          {rest.length > 0 && ` (and ${rest.length} more)`}. Fix the highlighted nodes to save again.
        </span>
      </Banner>
    );
  }

  if (saveState === 'error' && saveError?.kind === 'network') {
    return (
      <Banner tone="danger">
        <span>Can’t reach the server. Your changes are kept here and will be saved when it’s back.</span>
      </Banner>
    );
  }

  return null;
}

function Banner({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={`flex shrink-0 items-center gap-3 border-b px-4 py-2 text-sm ${
        tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'border-danger/40 bg-danger/10'
      }`}
    >
      {children}
    </div>
  );
}

function BannerButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-md border border-border bg-surface px-2.5 py-1 hover:bg-surface-raised disabled:opacity-50"
    />
  );
}
