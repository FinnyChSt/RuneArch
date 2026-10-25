import { Feature, FeatureStatus } from '@flowcanvas/shared';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { STATUS_LABEL } from '../canvas/featureView';
import { flowColorVar } from '../canvas/flowColors';
import { Modal } from '../components/ui/Modal';
import { Button, checkboxClass, controlClass, Field } from '../components/ui/form';
import { DialogFooter } from '../dialogs/DialogFooter';
import { ColorSwatches } from '../flows/ColorSwatches';
import { useCanvasStore } from '../store/canvasStore';

type Draft = {
  name: string;
  color: string;
  status: Feature['status'];
  description: string;
  /** One criterion / question per line */
  acceptance: string;
  openQuestions: string;
  flowIds: string[];
};

const toDraft = (f: Feature): Draft => ({
  name: f.name,
  color: f.color ?? 'violet',
  status: f.status,
  description: f.description ?? '',
  acceptance: f.acceptance.join('\n'),
  openQuestions: f.openQuestions.join('\n'),
  flowIds: f.flowIds,
});

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** The feature with the draft applied; items and baselines stay as they are */
export const fromDraft = (f: Feature, d: Draft): Feature => ({
  ...f,
  name: d.name,
  color: d.color,
  status: d.status,
  description: d.description.trim() || undefined,
  acceptance: lines(d.acceptance),
  openQuestions: lines(d.openQuestions),
  flowIds: d.flowIds,
});

/** Name, color, status, description, acceptance criteria, open questions and the feature's flows */
export function FeatureDialog({ feature, onClose }: { feature: Feature; onClose(): void }) {
  const flows = useCanvasStore((s) => s.doc.flows);
  const [draft, setDraft] = useState(() => toDraft(feature));
  const [nameError, setNameError] = useState<string>();
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    const result = Feature.safeParse(fromDraft(feature, draft));
    if (!result.success) {
      setNameError(result.error.issues.find((i) => i.path[0] === 'name')?.message ?? result.error.issues[0]?.message);
      return;
    }
    useCanvasStore.getState().saveFeature(result.data);
    onClose();
  };

  const remove = () => {
    if (!window.confirm(`Delete the feature "${feature.name}"? Its items stay on the canvas.`)) return;
    useCanvasStore.getState().removeFeature(feature.id);
    onClose();
  };

  const toggleFlow = (id: string, on: boolean) =>
    set({ flowIds: on ? [...draft.flowIds, id] : draft.flowIds.filter((f) => f !== id) });

  return (
    <Modal
      title="Edit feature"
      width="max-w-2xl"
      onClose={onClose}
      footer={
        <DialogFooter
          errors={[]}
          onCancel={onClose}
          onSave={save}
          start={
            <Button variant="ghost" className="hover:text-danger" onClick={remove}>
              <Trash2 className="size-4" /> Delete feature
            </Button>
          }
        />
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-[1fr_auto_auto] items-start gap-4">
          <Field label="Name" error={nameError}>
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} className={controlClass} autoComplete="off" />
          </Field>
          <Field label="Status">
            <select
              value={draft.status}
              onChange={(e) => set({ status: e.target.value as Draft['status'] })}
              className={controlClass}
            >
              {FeatureStatus.options.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">Color</span>
            <div className="py-1.5">
              <ColorSwatches value={draft.color} onChange={(color) => set({ color })} />
            </div>
          </div>
        </div>
        <Field label="Description">
          <textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} rows={2} className={controlClass} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Acceptance criteria" hint="One per line">
            <textarea
              value={draft.acceptance}
              onChange={(e) => set({ acceptance: e.target.value })}
              rows={4}
              className={controlClass}
            />
          </Field>
          <Field label="Open questions" hint="One per line">
            <textarea
              value={draft.openQuestions}
              onChange={(e) => set({ openQuestions: e.target.value })}
              rows={4}
              className={controlClass}
            />
          </Field>
        </div>
        <section>
          <h3 className="mb-1 text-xs font-medium text-text-muted">Flows that tell the feature's story</h3>
          {flows.length === 0 ? (
            <p className="text-text-muted">No flows yet. Record one in the Flows tab.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-1">
              {flows.map((f) => (
                <li key={f.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={draft.flowIds.includes(f.id)}
                      onChange={(e) => toggleFlow(f.id, e.target.checked)}
                    />
                    <span className="size-2 rounded-full" style={{ background: flowColorVar(f.color) }} />
                    {f.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
