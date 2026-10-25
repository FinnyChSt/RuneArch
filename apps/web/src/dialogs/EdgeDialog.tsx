import { CRUD_OPS } from '@flowcanvas/shared';
import { useMemo } from 'react';
import { nodeTitle, sourceTitle } from '../canvas/flowView';
import { Modal } from '../components/ui/Modal';
import { checkboxClass, controlClass, Field, FieldError } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { DialogFooter } from './DialogFooter';
import { edgeMapper, fromEdgeDraft, toEdgeDraft, withEdge, type EdgeDraft, type LinkEdge } from './edgeDraft';
import { useDraftForm } from './useDraftForm';

const mapper = () => edgeMapper;

/** Label of a link edge and, for table connections, the CRUD operations it performs */
export function EdgeDialog({ edge, onClose }: { edge: LinkEdge; onClose(): void }) {
  const source = useCanvasStore((s) => s.doc.nodes.find((n) => n.id === edge.source));
  const target = useCanvasStore((s) => s.doc.nodes.find((n) => n.id === edge.target));
  const intoTable = target?.type === 'table';
  const withTable = intoTable || source?.type === 'table';

  const build = useMemo(() => withEdge(edge, intoTable), [edge, intoTable]);
  const { form, errorFor, submit, generalErrors } = useDraftForm<EdgeDraft>({
    nodeId: edge.id,
    section: 'edges',
    defaultValues: toEdgeDraft(edge),
    build,
    mapper,
  });
  const { register } = form;

  const save = () =>
    submit((draft) => {
      useCanvasStore.getState().editEdge(fromEdgeDraft(edge, draft, intoTable));
      onClose();
    });

  return (
    <Modal
      title="Edit connection"
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
        <p className="text-xs text-text-muted">
          {sourceTitle(source, edge.sourceHandle)} → {nodeTitle(target)} · {edge.kind}
        </p>
        {withTable && (
          <fieldset>
            <legend className="mb-1 block text-xs font-medium text-text-muted">Operations</legend>
            <div className="flex flex-wrap gap-4">
              {CRUD_OPS.map((op) => (
                <label key={op} className="flex items-center gap-1.5 capitalize">
                  <input type="checkbox" {...register(`crud.${op}`)} className={checkboxClass} />
                  {op}
                </label>
              ))}
            </div>
            <FieldError message={errorFor('crud')} />
          </fieldset>
        )}
        <Field label="Label" hint="Shown on the edge instead of its operations or kind" error={errorFor('label')}>
          <input {...register('label')} className={controlClass} autoComplete="off" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
