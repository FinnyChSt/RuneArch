import { useMemo, useState } from 'react';
import { useWatch } from 'react-hook-form';
import type { NodeOf } from '../canvas/mapping';
import { Modal } from '../components/ui/Modal';
import { Tab, TabList, TabPanel, Tabs } from '../components/ui/Tabs';
import { controlClass, Field } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { DialogFooter } from './DialogFooter';
import { buildScreen, fromScreenDraft, screenMapper, toScreenDraft, type ScreenDraft } from './drafts';
import { useDraftForm } from './useDraftForm';
import { useUndo } from './wireframe/useUndo';
import { WireframeTab } from './wireframe/WireframeTab';
import { BaselineChanges } from '../features/ChangeList';

const mapper = () => screenMapper;

export function ScreenDialog({ node, onClose }: { node: NodeOf<'screen'>; onClose(): void }) {
  const build = useMemo(() => buildScreen(node), [node]);
  const { form, candidate, errorFor, hasErrorsUnder, submit, generalErrors } = useDraftForm<ScreenDraft>({
    nodeId: node.id,
    defaultValues: toScreenDraft(node, useCanvasStore.getState().doc),
    build,
    mapper,
  });
  const { register, control, setValue } = form;
  const [wireframe, links] = useWatch({ control, name: ['wireframe', 'links'] });
  // One undo history for the wireframe and its links: undoing a delete brings the element's links back
  const design = useMemo(() => ({ wireframe, links }), [wireframe, links]);
  const history = useUndo(design, (next) => {
    setValue('wireframe', next.wireframe, { shouldDirty: true });
    setValue('links', next.links, { shouldDirty: true });
  });
  const [tab, setTab] = useState('general');

  const save = () =>
    submit((draft) => {
      useCanvasStore.getState().editScreen(fromScreenDraft(node, draft), draft.links);
      onClose();
    });

  return (
    <Modal
      title="Edit screen"
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
            <Tab value="general" alert={hasErrorsUnder('label') || hasErrorsUnder('route') || hasErrorsUnder('state')}>
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
              <Field label="Route" error={errorFor('route')}>
                <input {...register('route')} className={`${controlClass} font-mono`} placeholder="/checkout" />
              </Field>
              <Field label="State" hint="One key per line, e.g. cart or selectedAddress" error={errorFor('state')}>
                <textarea {...register('state')} rows={4} className={`${controlClass} font-mono`} />
              </Field>
              <Field label="Notes" error={errorFor('notes')}>
                <textarea {...register('notes')} rows={3} className={controlClass} />
              </Field>
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
