import { modelUsages, type ApiModel, type TableNode } from '@flowcanvas/shared';
import { ChevronDown, ChevronUp, Plus, Trash2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useFieldArray } from 'react-hook-form';
import { TypePicker } from '../components/TypePicker';
import { Modal } from '../components/ui/Modal';
import { Button, checkboxClass, controlClass, Field, FieldError, IconAction } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { DialogFooter } from './DialogFooter';
import {
  buildModelDoc,
  draftFromTable,
  fromModelDraft,
  modelMapper,
  newFieldDraft,
  toModelDraft,
  type ModelDraft,
} from './modelDraft';
import { useDraftForm } from './useDraftForm';
import { BaselineChanges } from '../features/ChangeList';

const mapper = () => modelMapper;
const cell = `${controlClass} px-2 py-1 text-xs`;

type Props = { model: ApiModel; isNew: boolean; onClose(): void };

/** Model (DTO) editor: name, description, fields; can be generated from a table */
export function ModelDialog({ model, isNew, onClose }: Props) {
  const build = useMemo(() => buildModelDoc(model), [model]);
  const { form, draft, candidate, errorFor, submit, generalErrors } = useDraftForm<ModelDraft>({
    nodeId: model.id,
    section: 'models',
    defaultValues: toModelDraft(model),
    build,
    mapper,
  });
  const { register, control } = form;
  const fields = useFieldArray({ control, name: 'fields', keyName: 'key' });
  const [blocked, setBlocked] = useState<string[]>([]);

  // Other models can be referenced; this one too (e.g. a tree of itself)
  const models = candidate.models;
  const tables = useMemo(() => candidate.nodes.filter((n): n is TableNode => n.type === 'table'), [candidate.nodes]);
  const [tableId, setTableId] = useState(() => model.sourceTableId ?? tables[0]?.id ?? '');
  const source = tables.find((t) => t.id === draft.sourceTableId);

  const generate = () => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;
    if (draft.fields.length > 0 && !window.confirm(`Replace the current fields with the columns of ${table.label}?`))
      return;
    form.reset(draftFromTable(table, form.getValues()), { keepDefaultValues: true });
  };

  const save = () =>
    submit((d) => {
      useCanvasStore.getState().upsertModel(fromModelDraft(model, d));
      onClose();
    });

  const remove = () => {
    const usages = modelUsages(useCanvasStore.getState().doc, model.id);
    if (usages.length > 0) return setBlocked(usages);
    if (!window.confirm(`Delete the model ${model.name}?`)) return;
    useCanvasStore.getState().removeModel(model.id);
    onClose();
  };

  return (
    <Modal
      title={isNew ? 'New model' : 'Edit model'}
      width="max-w-5xl"
      onClose={onClose}
      footer={
        <DialogFooter
          errors={blocked.length ? [`Can’t delete: used by ${blocked.join(', ')}`, ...generalErrors] : generalErrors}
          onCancel={onClose}
          onSave={save}
          start={
            !isNew && (
              <Button variant="ghost" className="hover:text-danger" onClick={remove}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )
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
        <div className="grid grid-cols-[16rem_1fr] gap-3">
          <Field label="Name" error={errorFor('name')} hint={source && `Generated from table ${source.label}`}>
            <input {...register('name')} className={`${controlClass} font-mono`} placeholder="CreateOrderDto" autoComplete="off" />
          </Field>
          <Field label="Description" error={errorFor('description')}>
            <input {...register('description')} className={controlClass} />
          </Field>
        </div>

        {tables.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
            <Wand2 className="size-4 text-text-muted" />
            <span className="text-text-muted">Generate fields from table</span>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              aria-label="Source table"
              className={`${cell} w-auto font-mono`}
            >
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <Button className="px-2 py-1 text-xs" onClick={generate}>
              Generate
            </Button>
          </div>
        )}

        <table className="w-full border-separate border-spacing-x-1 border-spacing-y-1 text-left">
          <thead className="text-xs text-text-muted">
            <tr>
              <th className="font-medium">Field</th>
              <th className="font-medium">Type</th>
              <th className="w-9 text-center font-medium" title="Required">
                Req
              </th>
              <th className="w-9 text-center font-medium" title="Nullable">
                Null
              </th>
              <th className="font-medium">Example</th>
              <th className="font-medium">Description</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {fields.fields.map((f, i) => {
              const name = draft.fields?.[i]?.name || `field ${i + 1}`;
              return (
                <tr key={f.key} className="align-top">
                  <td className="w-44">
                    <input
                      {...register(`fields.${i}.name`)}
                      aria-label="Field name"
                      aria-invalid={errorFor(`fields.${i}.name`) ? true : undefined}
                      className={`${cell} font-mono`}
                      autoComplete="off"
                    />
                    <FieldError message={errorFor(`fields.${i}.name`)} />
                  </td>
                  <td>
                    <TypePicker
                      name={`fields.${i}.type`}
                      value={draft.fields?.[i]?.type}
                      register={register}
                      models={models}
                      label={`Type of ${name}`}
                      invalid={!!errorFor(`fields.${i}.type.base`)}
                    />
                    <FieldError message={errorFor(`fields.${i}.type.base`)} />
                  </td>
                  <td className="pt-1.5 text-center">
                    <input type="checkbox" {...register(`fields.${i}.required`)} aria-label={`${name} is required`} className={checkboxClass} />
                  </td>
                  <td className="pt-1.5 text-center">
                    <input type="checkbox" {...register(`fields.${i}.nullable`)} aria-label={`${name} is nullable`} className={checkboxClass} />
                  </td>
                  <td className="w-28">
                    <input {...register(`fields.${i}.example`)} aria-label={`Example for ${name}`} className={`${cell} font-mono`} />
                  </td>
                  <td>
                    <input {...register(`fields.${i}.description`)} aria-label={`Description of ${name}`} className={cell} />
                  </td>
                  <td className="whitespace-nowrap">
                    <IconAction label={`Move ${name} up`} disabled={i === 0} onClick={() => fields.swap(i, i - 1)}>
                      <ChevronUp className="size-3.5" />
                    </IconAction>
                    <IconAction label={`Move ${name} down`} disabled={i === fields.fields.length - 1} onClick={() => fields.swap(i, i + 1)}>
                      <ChevronDown className="size-3.5" />
                    </IconAction>
                    <IconAction label={`Remove ${name}`} onClick={() => fields.remove(i)}>
                      <Trash2 className="size-3.5" />
                    </IconAction>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {fields.fields.length === 0 && <p className="text-text-muted">No fields yet.</p>}
        <div>
          <Button variant="ghost" onClick={() => fields.append(newFieldDraft())}>
            <Plus className="size-4" /> Add field
          </Button>
        </div>
        <BaselineChanges candidate={candidate} itemRef={{ kind: 'model', id: model.id }} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
