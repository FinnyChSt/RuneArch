import { useMemo } from 'react';
import type { NodeOf } from '../canvas/mapping';
import { Modal } from '../components/ui/Modal';
import { controlClass, Field } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { DialogFooter } from './DialogFooter';
import { fromFrameDraft, frameMapper, toFrameDraft, withNode, type FrameDraft } from './drafts';
import { useDraftForm } from './useDraftForm';

const mapper = () => frameMapper;

const LANES: { value: FrameDraft['lane']; label: string }[] = [
  { value: 'none', label: 'Group (no lane)' },
  { value: 'frontend', label: 'Frontend lane' },
  { value: 'backend', label: 'Backend lane' },
  { value: 'database', label: 'Database lane' },
];

/** Frame title and lane (a lane takes its group's color) */
export function FrameDialog({ node, onClose }: { node: NodeOf<'frame'>; onClose(): void }) {
  const build = useMemo(() => withNode(node, fromFrameDraft), [node]);
  const { form, errorFor, submit, generalErrors } = useDraftForm<FrameDraft>({
    nodeId: node.id,
    defaultValues: toFrameDraft(node),
    build,
    mapper,
  });
  const { register } = form;

  const save = () =>
    submit((draft) => {
      useCanvasStore.getState().editNode(fromFrameDraft(node, draft));
      onClose();
    });

  return (
    <Modal title="Edit frame" onClose={onClose} footer={<DialogFooter errors={generalErrors} onCancel={onClose} onSave={save} />}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Title" error={errorFor('label')}>
          <input {...register('label')} className={controlClass} autoComplete="off" />
        </Field>
        <Field label="Kind">
          <select {...register('lane')} className={controlClass}>
            {LANES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" error={errorFor('notes')}>
          <textarea {...register('notes')} rows={3} className={controlClass} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
