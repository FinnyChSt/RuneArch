import { useMemo } from 'react';
import type { NodeOf } from '../canvas/mapping';
import { Modal } from '../components/ui/Modal';
import { controlClass, Field } from '../components/ui/form';
import { BaselineChanges } from '../features/ChangeList';
import { useCanvasStore } from '../store/canvasStore';
import { DialogFooter } from './DialogFooter';
import { cronHint, fromJobDraft, jobMapper, toJobDraft, withNode, type JobDraft } from './drafts';
import { useDraftForm } from './useDraftForm';

const mapper = () => jobMapper;

const TRIGGERS: { value: JobDraft['trigger']; label: string }[] = [
  { value: 'event', label: 'Event' },
  { value: 'queue', label: 'Queue job' },
  { value: 'cron', label: 'Scheduled job (cron)' },
];

/** Common schedules offered as suggestions in the Schedule field */
const PRESETS = [
  { value: '*/5 * * * *', label: 'Every 5 minutes' },
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 3 * * *', label: 'Daily at 03:00' },
  { value: '0 9 * * 1', label: 'Mondays at 09:00' },
  { value: '0 0 1 * *', label: 'Monthly, on the 1st' },
];

/** Job name, trigger and (for scheduled jobs) cron schedule */
export function JobDialog({ node, onClose }: { node: NodeOf<'job'>; onClose(): void }) {
  const build = useMemo(() => withNode(node, fromJobDraft), [node]);
  const { form, draft, candidate, errorFor, submit, generalErrors } = useDraftForm<JobDraft>({
    nodeId: node.id,
    defaultValues: toJobDraft(node),
    build,
    mapper,
  });
  const { register } = form;
  const scheduled = draft.trigger === 'cron';
  const presetsId = `${node.id}-schedule-presets`;

  const save = () =>
    submit((latest) => {
      useCanvasStore.getState().editNode(fromJobDraft(node, latest));
      onClose();
    });

  return (
    <Modal title="Edit job" onClose={onClose} footer={<DialogFooter errors={generalErrors} onCancel={onClose} onSave={save} />}>
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
        <Field label="Trigger" error={errorFor('trigger')}>
          <select {...register('trigger')} className={controlClass}>
            {TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        {scheduled && (
          <Field
            label="Schedule"
            error={errorFor('schedule')}
            hint={cronHint(draft.schedule ?? '') ?? 'Cron expression: minute hour day month weekday, e.g. 0 3 * * *'}
          >
            <input
              {...register('schedule')}
              className={`${controlClass} font-mono`}
              placeholder="0 3 * * *"
              list={presetsId}
              autoComplete="off"
            />
          </Field>
        )}
        <datalist id={presetsId}>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value} label={p.label} />
          ))}
        </datalist>
        <Field label="Notes" error={errorFor('notes')}>
          <textarea {...register('notes')} rows={3} className={controlClass} />
        </Field>
        <BaselineChanges candidate={candidate} itemRef={{ kind: 'node', id: node.id }} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
