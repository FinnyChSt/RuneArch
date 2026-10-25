import { typeLabel } from '@flowcanvas/shared';
import { useReactFlow } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { roleIn } from '../canvas/featureView';
import type { NodeOf } from '../canvas/mapping';
import { MethodBadge } from '../components/MethodBadge';
import { Button } from '../components/ui/form';
import { RoleBadge } from '../features/RoleBadge';
import { useFeatureView } from '../hooks/useFeatureView';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

type Endpoint = NodeOf<'endpoint'>;

const UNTAGGED = 'Other';

/** Endpoints by tag (an endpoint shows under each of its tags); untagged ones last */
export function groupByTag(endpoints: Endpoint[]): [string, Endpoint[]][] {
  const groups = new Map<string, Endpoint[]>();
  for (const e of endpoints) for (const tag of e.data.spec.tags.length ? e.data.spec.tags : [UNTAGGED]) {
    groups.set(tag, [...(groups.get(tag) ?? []), e]);
  }
  const byPath = (a: Endpoint, b: Endpoint) => a.data.path.localeCompare(b.data.path) || a.data.method.localeCompare(b.data.method);
  return [...groups]
    .map(([tag, list]): [string, Endpoint[]] => [tag, list.sort(byPath)])
    .sort(([a], [b]) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b)));
}

/** Right panel "API" tab: endpoints grouped by tag, and the models (DTOs) */
export function ApiPanel() {
  const nodes = useCanvasStore((s) => s.doc.nodes);
  const models = useCanvasStore((s) => s.doc.models);
  const feature = useFeatureView();
  const groups = useMemo(() => groupByTag(nodes.filter((n): n is Endpoint => n.type === 'endpoint')), [nodes]);
  const { setCenter, getZoom } = useReactFlow();
  const measured = useCanvasStore((s) => s.measured);

  // Select it, bring it into view, and open its dialog
  const openEndpoint = (e: Endpoint) => {
    const size = measured[e.id] ?? { width: 180, height: 70 };
    void setCenter(e.position.x + size.width / 2, e.position.y + size.height / 2, { zoom: getZoom(), duration: 250 });
    const ui = useUiStore.getState();
    ui.setSelection([e.id]);
    ui.openDialog({ kind: 'endpoint', id: e.id });
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-3">
      <h3 className="px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-text-muted uppercase">Endpoints</h3>
      {groups.length === 0 && <p className="px-3 text-text-muted">No endpoints yet. Press E and click the canvas.</p>}
      {groups.map(([tag, endpoints]) => (
        <section key={tag} className="px-2">
          <h4 className="px-1 pt-2 pb-0.5 text-xs text-text-muted">{tag}</h4>
          <ul>
            {endpoints.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => openEndpoint(e)}
                  aria-label={`${e.data.method} ${e.data.path}`}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-raised"
                >
                  <MethodBadge method={e.data.method} className="w-14 text-center" />
                  <span className={`truncate font-mono text-xs ${e.data.spec.deprecated ? 'line-through opacity-60' : ''}`}>
                    {e.data.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="mt-4 flex items-center justify-between px-3 pb-1">
        <h3 className="text-xs font-medium tracking-wide text-text-muted uppercase">Models</h3>
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => useUiStore.getState().openDialog({ kind: 'model' })}>
          <Plus className="size-3.5" /> New model
        </Button>
      </div>
      {models.length === 0 && <p className="px-3 text-text-muted">No models yet. Models describe request and response bodies.</p>}
      <ul className="px-2">
        {models.map((m) => {
          const role = roleIn(feature, { kind: 'model', id: m.id });
          const marks = feature?.fields.get(m.id);
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => useUiStore.getState().openDialog({ kind: 'model', id: m.id })}
                className="w-full rounded-md px-1.5 py-1 text-left hover:bg-surface-raised"
              >
                <div className="flex items-center gap-1.5 font-mono text-xs">
                  {m.name}
                  {role && <RoleBadge role={role} color={feature?.color} />}
                </div>
                <div className="truncate text-[11px] text-text-muted">
                  {m.fields.length === 0
                    ? 'no fields'
                    : m.fields
                        .map((f) => `${marks?.[f.id] === 'added' ? '+' : marks?.[f.id] === 'changed' ? '~' : ''}${f.name}: ${typeLabel(f.type, models)}`)
                        .join(', ')}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
