import {
  describeEntry,
  diffModel,
  diffNode,
  featureById,
  roleOf,
  sameNodeContent,
  sameValue,
  type CanvasDoc,
  type DiffEntry,
  type FeatureItemRef,
} from '@flowcanvas/shared';
import { Undo2 } from 'lucide-react';
import { flowColorVar } from '../canvas/flowColors';
import { IconAction } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';

/** One line per change; `onRevert` adds an undo button to each */
export function ChangeList({ entries, onRevert }: { entries: readonly DiffEntry[]; onRevert?(entry: DiffEntry): void }) {
  return (
    <ul className="grid gap-0.5 font-mono text-[11px]">
      {entries.map((entry) => {
        const text = describeEntry(entry);
        return (
          <li key={`${entry.path.join('.')}:${entry.type === 'prop' ? '' : entry.key}`} className="flex items-start gap-1">
            <span className="min-w-0 flex-1 break-words">{text}</span>
            {onRevert && (
              <IconAction label={`Revert: ${text}`} onClick={() => onRevert(entry)}>
                <Undo2 className="size-3" />
              </IconAction>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const itemOf = (doc: CanvasDoc, ref: FeatureItemRef) =>
  ref.kind === 'node' ? doc.nodes.find((n) => n.id === ref.id) : ref.kind === 'model' ? doc.models.find((m) => m.id === ref.id) : undefined;

/**
 * For dialogs: what the draft (`candidate`, the doc with the draft applied) changes against each
 * feature's baseline of this item, live while editing. When working on a feature that doesn't
 * change the item yet, says that saving will mark it as changed.
 */
export function BaselineChanges({ candidate, itemRef }: { candidate: CanvasDoc; itemRef: FeatureItemRef }) {
  const saved = useCanvasStore((s) => itemOf(s.doc, itemRef));
  const active = useCanvasStore((s) => (s.activeFeatureId ? featureById(s.doc, s.activeFeatureId) : undefined));
  const draft = itemOf(candidate, itemRef);
  if (!draft) return null;

  const sections = candidate.features.flatMap((f) => {
    const baseline = itemRef.kind === 'node' ? f.baseline.nodes[itemRef.id] : f.baseline.models[itemRef.id];
    if (!baseline) return [];
    const entries =
      itemRef.kind === 'node' && 'type' in draft && 'type' in baseline
        ? diffNode(baseline, draft)
        : 'fields' in draft && 'fields' in baseline
          ? diffModel(baseline, draft)
          : [];
    return [{ feature: f, entries }];
  });

  const role = active ? roleOf(active, itemRef) : undefined;
  const edited =
    saved !== undefined &&
    ('type' in saved && 'type' in draft ? !sameNodeContent(saved, draft) : !sameValue(saved, draft));
  const willTag = active && edited && (role === undefined || role === 'uses');

  if (sections.length === 0 && !willTag) return null;
  return (
    <section aria-label="Changes against the baseline" className="grid gap-2 rounded-lg border border-border bg-surface p-3 text-xs">
      {willTag && (
        <p>
          Saving marks this as changed in{' '}
          <span className="font-medium" style={{ color: flowColorVar(active.color) }}>
            {active.name}
          </span>{' '}
          and keeps the current version as its baseline.
        </p>
      )}
      {sections.map(({ feature, entries }) => (
        <div key={feature.id}>
          <h3 className="mb-1 flex items-center gap-1.5 font-medium text-text-muted">
            <span className="size-2 rounded-full" style={{ background: flowColorVar(feature.color) }} />
            Changes in {feature.name} · {entries.length}
          </h3>
          {entries.length === 0 ? (
            <p className="text-text-muted">Same as before the feature.</p>
          ) : (
            <ChangeList entries={entries} />
          )}
        </div>
      ))}
    </section>
  );
}
