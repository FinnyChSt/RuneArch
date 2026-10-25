import { componentUsages } from '@flowcanvas/shared';
import { useMemo, useState } from 'react';
import { useWatch } from 'react-hook-form';
import type { NodeOf } from '../canvas/mapping';
import { Modal } from '../components/ui/Modal';
import { Tab, TabList, TabPanel, Tabs } from '../components/ui/Tabs';
import { controlClass, Field } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { DialogFooter } from './DialogFooter';
import { componentMapper, fromComponentDraft, toComponentDraft, withNode, type ComponentDraft } from './drafts';
import { useDraftForm } from './useDraftForm';
import { useUndo } from './wireframe/useUndo';
import { WireframeTab } from './wireframe/WireframeTab';
import { BaselineChanges } from '../features/ChangeList';

const mapper = () => componentMapper;

/** Name, props and the reusable wireframe that screens place as instances */
export function ComponentDialog({ node, onClose }: { node: NodeOf<'component'>; onClose(): void }) {
  const build = useMemo(() => withNode(node, fromComponentDraft), [node]);
  const { form, candidate, errorFor, hasErrorsUnder, submit, generalErrors } = useDraftForm<ComponentDraft>({
    nodeId: node.id,
    defaultValues: toComponentDraft(node),
    build,
    mapper,
  });
  const { register, control, setValue } = form;
  const [wireframe, links] = useWatch({ control, name: ['wireframe', 'links'] });
  const design = useMemo(() => ({ wireframe, links }), [wireframe, links]);
  const history = useUndo(design, (next) => setValue('wireframe', next.wireframe, { shouldDirty: true }));
  const [tab, setTab] = useState('general');
  const usedOn = useCanvasStore((s) => componentUsages(s.doc, node.id).join(', '));

  const save = () =>
    submit((draft) => {
      useCanvasStore.getState().editNode(fromComponentDraft(node, draft));
      onClose();
    });

  return (
    <Modal
      title="Edit component"
      width={tab === 'wireframe' ? 'max-w-6xl' : undefined}
      onClose={onClose}
      footer={<DialogFooter errors={generalErrors} onCancel={onClose} onSave={save} />}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Tabs value={tab} onValueChange={setTab}>
          <TabList>
            <Tab value="general" alert={hasErrorsUnder('label') || hasErrorsUnder('props')}>
              General
            </Tab>
            <Tab value="wireframe" alert={hasErrorsUnder('wireframe')}>
              Wireframe
            </Tab>
          </TabList>
          <TabPanel value="general">
            <div className="grid gap-4">
              <Field label="Name" error={errorFor('label')}>
                <input {...register('label')} className={controlClass} autoComplete="off" />
              </Field>
              <Field label="Props" hint="One per line, e.g. product or onAddToCart" error={errorFor('props')}>
                <textarea {...register('props')} rows={4} className={`${controlClass} font-mono`} />
              </Field>
              <Field label="Notes" error={errorFor('notes')}>
                <textarea {...register('notes')} rows={3} className={controlClass} />
              </Field>
              <p className="text-xs text-text-muted">{usedOn ? `Placed on: ${usedOn}` : 'Not placed on any screen yet.'}</p>
            </div>
          </TabPanel>
          <TabPanel value="wireframe">
            <WireframeTab node={node} design={design} history={history} error={errorFor('wireframe')} />
          </TabPanel>
        </Tabs>
        <BaselineChanges candidate={candidate} itemRef={{ kind: 'node', id: node.id }} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
