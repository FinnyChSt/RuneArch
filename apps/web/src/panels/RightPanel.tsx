import { ApiPanel } from '../api-design/ApiPanel';
import { FeaturesPanel } from '../features/FeaturesPanel';
import { FlowsPanel } from '../flows/FlowsPanel';
import { HistoryPanel } from '../history/HistoryPanel';
import { useUiStore } from '../store/uiStore';

const TABS = [
  { id: 'flows', label: 'Flows' },
  { id: 'features', label: 'Features' },
  { id: 'api', label: 'API' },
  { id: 'history', label: 'History' },
] as const;

/** Flows, Features, API and History tabs */
export function RightPanel() {
  const panel = useUiStore((s) => s.rightPanel);
  const setRightPanel = useUiStore((s) => s.setRightPanel);
  if (!panel) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-surface text-sm">
      <div role="tablist" className="flex gap-1 border-b border-border px-2 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={panel === t.id}
            onClick={() => setRightPanel(t.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 transition-colors ${
              panel === t.id ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        {panel === 'flows' ? (
          <FlowsPanel />
        ) : panel === 'features' ? (
          <FeaturesPanel />
        ) : panel === 'api' ? (
          <ApiPanel />
        ) : (
          <HistoryPanel />
        )}
      </div>
    </aside>
  );
}
