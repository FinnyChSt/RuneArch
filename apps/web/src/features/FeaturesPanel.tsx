import {
  FEATURE_ROLES,
  featureChanges,
  featureItemKey,
  type Feature,
  type FeatureChanges,
  type FeatureItem,
  type FeatureRole,
  type ItemChange,
} from '@flowcanvas/shared';
import { ChevronDown, ChevronRight, Crosshair, Download, Eye, Info, Pencil, Plus, Rocket, Trash2, TriangleAlert, Undo2, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { itemsByRole, itemTitle, nextFeatureColor, ROLE_LABEL, STATUS_LABEL } from '../canvas/featureView';
import { flowColorVar } from '../canvas/flowColors';
import { Button, checkboxClass, compactControlClass, controlClass, IconAction } from '../components/ui/form';
import { ColorSwatches } from '../flows/ColorSwatches';
import { ChangeList } from './ChangeList';
import { discardFeatureAfterAsking, shipFeatureWithCheckpoint } from './lifecycleActions';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

/** Order of the item groups in the panel: what the feature brings first */
const GROUP_ORDER: FeatureRole[] = ['added', 'changed', 'removed', 'uses'];

/** Right panel "Features" tab: create, work on, highlight and inspect features */
export function FeaturesPanel() {
  const features = useCanvasStore((s) => s.doc.features);
  const hideUnshipped = useUiStore((s) => s.hideUnshipped);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs text-text-muted">
          {features.length} feature{features.length === 1 ? '' : 's'}
        </span>
        {!creating && (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> New feature
          </Button>
        )}
      </div>
      <label className="flex items-center gap-2 px-3 pb-2 text-xs text-text-muted">
        <input
          type="checkbox"
          className={checkboxClass}
          checked={hideUnshipped}
          onChange={(e) => useUiStore.getState().setHideUnshipped(e.target.checked)}
        />
        Hide what unshipped features add
      </label>
      {creating && <NewFeatureForm onDone={() => setCreating(false)} />}
      {features.length === 0 && !creating && (
        <p className="px-4 py-2 text-text-muted">
          No features yet. A feature marks what it uses as existing and what it adds, changes or removes, e.g.
          “Wishlist”: a new table and endpoint on top of the existing users table.
        </p>
      )}
      <ul className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {features.map((f) => (
          <FeatureRow key={f.id} feature={f} />
        ))}
      </ul>
    </div>
  );
}

function NewFeatureForm({ onDone }: { onDone(): void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(() => nextFeatureColor(useCanvasStore.getState().doc));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const canvas = useCanvasStore.getState();
    const id = canvas.addFeature({ name: name.trim(), color });
    canvas.setActiveFeature(id);
    useUiStore.getState().selectFeature(id);
    onDone();
  };

  return (
    <form onSubmit={submit} className="mx-2 mb-2 grid gap-2 rounded-lg border border-border bg-surface-raised p-3">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
        placeholder="Feature name, e.g. Wishlist"
        aria-label="Feature name"
        className={controlClass}
      />
      <ColorSwatches value={color} onChange={setColor} />
      <div className="flex justify-end gap-2">
        <Button className="px-2 py-1 text-xs" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="px-2 py-1 text-xs" disabled={!name.trim()}>
          <Crosshair className="size-3.5" /> Create and work on it
        </Button>
      </div>
    </form>
  );
}

/** "+2 ~1 −1 · 3 existing" */
function counts(feature: Feature) {
  const g = itemsByRole(feature);
  const parts = [
    g.added.length && `+${g.added.length}`,
    g.changed.length && `~${g.changed.length}`,
    g.removed.length && `−${g.removed.length}`,
  ].filter(Boolean);
  const uses = g.uses.length ? `${g.uses.length} existing` : '';
  return [parts.join(' '), uses].filter(Boolean).join(' · ') || 'empty';
}

function FeatureRow({ feature }: { feature: Feature }) {
  const viewed = useUiStore((s) => s.viewFeatureId === feature.id);
  const working = useCanvasStore((s) => s.activeFeatureId === feature.id);
  const ui = useUiStore.getState;
  const canvas = useCanvasStore.getState;
  const color = flowColorVar(feature.color);
  const open = viewed || working;

  const toggleWork = () => {
    canvas().setActiveFeature(working ? null : feature.id);
    if (!working) ui().selectFeature(feature.id);
  };

  const remove = () => {
    if (window.confirm(`Delete the feature "${feature.name}"? Its items stay on the canvas.`))
      canvas().removeFeature(feature.id);
  };

  return (
    <li className={`mb-1 rounded-lg ${open ? 'bg-surface-raised' : ''}`}>
      <div className="group flex items-center gap-1 pr-1">
        <button
          type="button"
          aria-pressed={viewed}
          onClick={() => ui().selectFeature(viewed ? null : feature.id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-raised"
        >
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{feature.name}</span>
            <span className="truncate text-xs text-text-muted">
              {STATUS_LABEL[feature.status]} · {counts(feature)}
            </span>
          </span>
        </button>
        <div className={`flex ${open ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
          <IconAction label={working ? `Stop working on ${feature.name}` : `Work on ${feature.name}`} onClick={toggleWork}>
            <Crosshair className="size-3.5" style={working ? { color } : undefined} />
          </IconAction>
          <IconAction label={`Edit ${feature.name}`} onClick={() => ui().openDialog({ kind: 'feature', id: feature.id })}>
            <Pencil className="size-3.5" />
          </IconAction>
          <IconAction label={`Export ${feature.name}`} onClick={() => ui().openDialog({ kind: 'featureExport', id: feature.id })}>
            <Download className="size-3.5" />
          </IconAction>
          <IconAction label={`Delete ${feature.name}`} onClick={remove}>
            <Trash2 className="size-3.5" />
          </IconAction>
          {viewed && (
            <IconAction label="Show whole canvas" onClick={() => ui().selectFeature(null)}>
              <Eye className="size-3.5" />
            </IconAction>
          )}
        </div>
      </div>
      {open && <FeatureDetails feature={feature} working={working} />}
    </li>
  );
}

function FeatureDetails({ feature, working }: { feature: Feature; working: boolean }) {
  const groups = itemsByRole(feature);
  const doc = useCanvasStore((s) => s.doc);
  const changes = useMemo(() => featureChanges(doc, feature.id), [doc, feature.id]);
  const byItem = useMemo(() => new Map(changes?.items.map((c) => [featureItemKey(c.ref), c])), [changes]);
  return (
    <div className="flex min-w-0 flex-col gap-2 px-2 pb-2 text-xs">
      {feature.description && <p className="px-1 text-text-muted">{feature.description}</p>}
      <TextList title="Acceptance criteria" items={feature.acceptance} />
      <TextList title="Open questions" items={feature.openQuestions} />
      {changes && <Warnings feature={feature} changes={changes} apiVersion={doc.api.version} />}
      {feature.items.length === 0 ? (
        <p className="px-1 text-text-muted">
          {working
            ? 'What you add or edit on the canvas now is tagged in this feature. Right-click a node or edge to mark it as existing or removed.'
            : 'No items yet. Work on the feature to tag what you add or edit, or right-click a node or edge.'}
        </p>
      ) : (
        GROUP_ORDER.map(
          (role) =>
            groups[role].length > 0 && (
              <section key={role}>
                <h4 className="mb-0.5 px-1 font-medium text-text-muted">
                  {ROLE_LABEL[role]} · {groups[role].length}
                </h4>
                <ul className="flex flex-col gap-1">
                  {groups[role].map((item) => (
                    <ItemRow
                      key={featureItemKey(item.ref)}
                      feature={feature}
                      item={item}
                      change={byItem.get(featureItemKey(item.ref))}
                    />
                  ))}
                </ul>
              </section>
            ),
        )
      )}
      <Lifecycle feature={feature} />
    </div>
  );
}

/** Ship (checkpoint first) or discard the feature; both ask first and are one undo step */
function Lifecycle({ feature }: { feature: Feature }) {
  const [busy, setBusy] = useState(false);
  const ship = async () => {
    setBusy(true);
    try {
      await shipFeatureWithCheckpoint(feature.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-1 border-t border-border px-1 pt-2">
      {feature.status !== 'shipped' && (
        <Button variant="primary" className="px-2 py-0.5 text-xs" disabled={busy} onClick={() => void ship()}>
          <Rocket className="size-3" /> Ship…
        </Button>
      )}
      {feature.status === 'shipped' ? (
        <span className="text-text-muted">Shipped: its work is part of the project.</span>
      ) : (
        <Button variant="ghost" className="px-2 py-0.5 text-xs hover:text-danger" disabled={busy} onClick={() => discardFeatureAfterAsking(feature.id)}>
          <Undo2 className="size-3" /> Discard…
        </Button>
      )}
    </div>
  );
}

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="px-1">
      <h4 className="mb-0.5 font-medium text-text-muted">{title}</h4>
      <ul className="list-disc pl-4">
        {items.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

function ItemRow({ feature, item, change }: { feature: Feature; item: FeatureItem; change?: ItemChange }) {
  const title = useCanvasStore((s) => itemTitle(s.doc, item.ref));
  const [note, setNote] = useState(item.note ?? '');
  const [open, setOpen] = useState(false);
  const entries = change?.entries ?? [];
  const links = change?.addedLinks ?? [];
  const canvas = useCanvasStore.getState;

  // A note is saved when the field is left (one undo step), not on every key
  const saveNote = () => {
    const text = note.trim();
    if (text === (item.note ?? '')) return;
    const items = feature.items.map((i) => (i === item ? { ...i, note: text || undefined } : i));
    canvas().saveFeature({ ...feature, items });
  };

  const show = () => {
    if (item.ref.kind === 'model') return;
    const ui = useUiStore.getState();
    ui.setSelection([item.ref.id]);
    if (item.ref.kind === 'node') ui.requestFit([item.ref.id]);
  };

  return (
    <li className="min-w-0 rounded-md border border-border bg-surface px-1.5 py-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={show}
          title={item.ref.kind === 'model' ? `Model ${title}` : `${title} (show on the canvas)`}
          className="min-w-0 flex-1 truncate text-left hover:underline"
        >
          {item.ref.kind === 'model' && <span className="text-text-muted">Model </span>}
          {title}
        </button>
        <select
          aria-label={`Role of ${title}`}
          value={item.role}
          onChange={(e) => canvas().setFeatureItem(feature.id, item.ref, e.target.value as FeatureRole)}
          className={`${compactControlClass} py-0.5`}
        >
          {FEATURE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <IconAction label={`Take ${title} out of the feature`} onClick={() => canvas().removeFeatureItem(feature.id, item.ref)}>
          <X className="size-3.5" />
        </IconAction>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={saveNote}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label={`Note for ${title}`}
        placeholder="Why the feature needs this (optional)"
        className={`${controlClass} mt-1 py-0.5 text-xs`}
      />
      {(entries.length > 0 || links.length > 0) && (
        <ItemChanges feature={feature} item={item} title={title} open={open} onToggle={() => setOpen(!open)} change={change!} />
      )}
    </li>
  );
}

/** A changed item's diff against the baseline, with revert per change and for the whole item */
function ItemChanges({
  feature,
  item,
  title,
  open,
  onToggle,
  change,
}: {
  feature: Feature;
  item: FeatureItem;
  title: string;
  open: boolean;
  onToggle(): void;
  change: ItemChange;
}) {
  const doc = useCanvasStore((s) => s.doc);
  const report = (result: { ok: true } | { ok: false; reason: string }) => {
    if (!result.ok) useUiStore.getState().showHint(result.reason);
  };
  const count = change.entries.length;
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex items-center gap-0.5 text-text-muted hover:text-text"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {count > 0 && `${count} change${count === 1 ? '' : 's'}`}
        {count > 0 && change.addedLinks.length > 0 && ' · '}
        {change.addedLinks.length > 0 && `${change.addedLinks.length} new link${change.addedLinks.length === 1 ? '' : 's'}`}
      </button>
      {open && (
        <div className="mt-1 grid gap-1 pl-3">
          <ChangeList
            entries={change.entries}
            onRevert={(entry) => report(useCanvasStore.getState().revertFeatureEntry(feature.id, item.ref, entry))}
          />
          {change.addedLinks.map((id) => (
            <p key={id} className="font-mono text-[11px]">
              + Link {itemTitle(doc, { kind: 'edge', id })}
            </p>
          ))}
          {count > 0 && (
            <Button
              variant="ghost"
              className="justify-self-start px-1.5 py-0.5 text-[11px]"
              onClick={() => report(useCanvasStore.getState().revertFeatureItem(feature.id, item.ref))}
            >
              <Undo2 className="size-3" /> Revert {title} to before the feature
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const WARNING_ICON: Record<FeatureChanges['warnings'][number]['code'], 'alert' | 'info'> = {
  backfill: 'alert',
  breaking: 'alert',
  drift: 'alert',
  'uncalled-endpoint': 'info',
  'unused-table': 'info',
  'outside-flow': 'info',
  conflict: 'alert',
  dependency: 'info',
};

/** The feature's warnings (never blocking) and the API version its changes call for */
function Warnings({ feature, changes, apiVersion }: { feature: Feature; changes: FeatureChanges; apiVersion: string }) {
  const { warnings, apiBump, nextApiVersion } = changes;
  if (warnings.length === 0 && !apiBump) return null;
  const applyVersion = () => {
    const { doc, updateApiSettings } = useCanvasStore.getState();
    if (nextApiVersion) updateApiSettings({ ...doc.api, version: nextApiVersion });
  };
  return (
    <section aria-label="Warnings" className="px-1">
      <h4 className="mb-0.5 font-medium text-text-muted">Warnings · {warnings.length}</h4>
      {apiBump && (
        <p className="mb-1 flex items-center gap-1.5">
          <Info className="size-3 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            API: {apiBump} change{nextApiVersion && ` (${apiVersion} → ${nextApiVersion})`}
          </span>
          {nextApiVersion && nextApiVersion !== apiVersion && (
            <Button variant="ghost" className="px-1.5 py-0 text-[11px]" onClick={applyVersion}>
              Apply
            </Button>
          )}
        </p>
      )}
      <ul className="grid gap-1">
        {warnings.map((w, i) => (
          <li key={i} className="flex items-start gap-1.5">
            {WARNING_ICON[w.code] === 'alert' ? (
              <TriangleAlert aria-label="Warning" className="mt-0.5 size-3 shrink-0 text-warning" />
            ) : (
              <Info aria-label="Note" className="mt-0.5 size-3 shrink-0 text-text-muted" />
            )}
            <span className="flex min-w-0 flex-1 flex-col items-start">
              {w.message}
              {w.code === 'outside-flow' && w.ref && (
                <Button
                  variant="ghost"
                  className="-ml-1.5 px-1.5 py-0 text-[11px]"
                  onClick={() => useCanvasStore.getState().setFeatureItem(feature.id, w.ref!, 'uses')}
                >
                  Add as existing
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
