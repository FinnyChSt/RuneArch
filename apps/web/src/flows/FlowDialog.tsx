import type { Flow } from '@flowcanvas/shared';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Controller, useFieldArray } from 'react-hook-form';
import { Modal } from '../components/ui/Modal';
import { Button, controlClass, Field, FieldError, IconAction } from '../components/ui/form';
import { DialogFooter } from '../dialogs/DialogFooter';
import { buildFlowDoc, flowMapper, fromFlowDraft, toFlowDraft, type FlowDraft } from '../dialogs/flowDraft';
import { useDraftForm } from '../dialogs/useDraftForm';
import { useCanvasStore } from '../store/canvasStore';
import { ColorSwatches } from './ColorSwatches';
import { StepLabel } from './StepLabel';

const mapper = () => flowMapper;

/** Name, color, description and the ordered steps (notes, reorder, remove) */
export function FlowDialog({ flow, onClose }: { flow: Flow; onClose(): void }) {
  const build = useMemo(() => buildFlowDoc(flow), [flow]);
  const { form, candidate, errorFor, submit, generalErrors } = useDraftForm<FlowDraft>({
    nodeId: flow.id,
    section: 'flows',
    defaultValues: toFlowDraft(flow),
    build,
    mapper,
  });
  const { register, control } = form;
  const steps = useFieldArray({ control, name: 'steps', keyName: 'key' });

  const save = () =>
    submit((draft) => {
      useCanvasStore.getState().saveFlow(fromFlowDraft(flow, draft));
      onClose();
    });

  const remove = () => {
    if (!window.confirm(`Delete the flow "${flow.name}"? Its edges stay on the canvas.`)) return;
    useCanvasStore.getState().removeFlow(flow.id);
    onClose();
  };

  return (
    <Modal
      title="Edit flow"
      width="max-w-2xl"
      onClose={onClose}
      footer={
        <DialogFooter
          errors={generalErrors}
          onCancel={onClose}
          onSave={save}
          start={
            <Button variant="ghost" className="hover:text-danger" onClick={remove}>
              <Trash2 className="size-4" /> Delete flow
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
        <div className="grid grid-cols-[1fr_auto] items-start gap-4">
          <Field label="Name" error={errorFor('name')}>
            <input {...register('name')} className={controlClass} autoComplete="off" />
          </Field>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">Color</span>
            <div className="py-1.5">
              <Controller
                control={control}
                name="color"
                render={({ field }) => <ColorSwatches value={field.value} onChange={field.onChange} />}
              />
            </div>
          </div>
        </div>
        <Field label="Description" error={errorFor('description')}>
          <textarea {...register('description')} rows={2} className={controlClass} />
        </Field>

        <section>
          <h3 className="mb-1 text-xs font-medium text-text-muted">Steps</h3>
          {steps.fields.length === 0 && (
            <p className="text-text-muted">No steps yet. Use “Record” in the Flows panel and click edges in order.</p>
          )}
          <ol className="grid gap-1.5">
            {steps.fields.map((field, i) => (
              <li key={field.key} className="rounded-lg border border-border bg-surface px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-5 text-center font-mono text-xs text-text-muted">{i + 1}</span>
                  <span className="flex min-w-0 flex-1">
                    <StepLabel doc={candidate} edgeId={field.edgeId} />
                  </span>
                  <IconAction label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => steps.swap(i, i - 1)}>
                    <ChevronUp className="size-3.5" />
                  </IconAction>
                  <IconAction
                    label={`Move step ${i + 1} down`}
                    disabled={i === steps.fields.length - 1}
                    onClick={() => steps.swap(i, i + 1)}
                  >
                    <ChevronDown className="size-3.5" />
                  </IconAction>
                  <IconAction label={`Remove step ${i + 1}`} onClick={() => steps.remove(i)}>
                    <Trash2 className="size-3.5" />
                  </IconAction>
                </div>
                <input
                  {...register(`steps.${i}.note`)}
                  aria-label={`Note for step ${i + 1}`}
                  placeholder="Note (optional)"
                  className={`${controlClass} mt-1.5 py-1 text-xs`}
                />
                <FieldError message={errorFor(`steps.${i}.edgeId`)} />
              </li>
            ))}
          </ol>
        </section>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
