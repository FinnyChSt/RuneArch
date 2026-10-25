import { useMemo } from 'react';
import type { NodeOf } from '../canvas/mapping';
import { Modal } from '../components/ui/Modal';
import { controlClass, Field } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { DialogFooter } from './DialogFooter';
import { fromServiceDraft, serviceMapper, toServiceDraft, withNode, type ServiceDraft } from './drafts';
import { useDraftForm } from './useDraftForm';
import { BaselineChanges } from '../features/ChangeList';

const mapper = () => serviceMapper;

export function ServiceDialog({ node, onClose }: { node: NodeOf<'service'>; onClose(): void }) {
  const build = useMemo(() => withNode(node, fromServiceDraft), [node]);
  const { form, candidate, errorFor, submit, generalErrors } = useDraftForm<ServiceDraft>({
    nodeId: node.id,
    defaultValues: toServiceDraft(node),
    build,
    mapper,
  });
  const { register } = form;

  const save = () =>
    submit((draft) => {
      useCanvasStore.getState().editNode(fromServiceDraft(node, draft));
      onClose();
    });

  return (
    <Modal
      title="Edit service"
      onClose={onClose}
      footer={<DialogFooter errors={generalErrors} onCancel={onClose} onSave={save} />}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" error={errorFor('label')}>
          <input {...register('label')} className={controlClass} autoComplete="off" />
        </Field>
        <Field label="Methods" hint="One method per line, e.g. createOrder" error={errorFor('methods')}>
          <textarea {...register('methods')} rows={4} className={`${controlClass} font-mono`} />
        </Field>
        <Field label="Notes" error={errorFor('notes')}>
          <textarea {...register('notes')} rows={3} className={controlClass} />
        </Field>
        <BaselineChanges candidate={candidate} itemRef={{ kind: 'node', id: node.id }} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
