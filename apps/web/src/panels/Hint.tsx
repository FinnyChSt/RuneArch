import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';

/** Transient message at the bottom of the canvas */
export function Hint() {
  const hint = useUiStore((s) => s.hint);
  const clearHint = useUiStore((s) => s.clearHint);

  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => clearHint(hint.id), 3500);
    return () => clearTimeout(timer);
  }, [hint, clearHint]);

  if (!hint) return null;
  return (
    <div
      role="status"
      className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm"
    >
      {hint.message}
    </div>
  );
}
