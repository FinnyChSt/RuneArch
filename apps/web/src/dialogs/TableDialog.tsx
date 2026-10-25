import { DIALECTS, tableToDdl, type TableNode } from '@flowcanvas/shared';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Controller, useFieldArray } from 'react-hook-form';
import { Modal } from '../components/ui/Modal';
import { Tab, TabList, TabPanel, Tabs } from '../components/ui/Tabs';
import { Button, checkboxClass, controlClass, Field, FieldError, IconAction } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { DialogFooter } from './DialogFooter';
import {
  buildTableDoc,
  fromTableDraft,
  newColumnDraft,
  newIndexDraft,
  ON_DELETE,
  referenceOptions,
  tableMapper,
  toTableDraft,
  type TableDraft,
} from './tableDraft';
import { useDraftForm } from './useDraftForm';
import { BaselineChanges } from '../features/ChangeList';

const cell = `${controlClass} px-2 py-1 font-mono text-xs`;

type Props = { node: TableNode; focusColumnId?: string; onClose(): void };

export function TableDialog({ node, focusColumnId, onClose }: Props) {
  const [defaultValues] = useState(() => toTableDraft(node, useCanvasStore.getState().doc));
  const build = useCallback((doc: Parameters<typeof buildTableDoc>[0], d: TableDraft) => buildTableDoc(doc, node, d), [node]);
  const mapper = useCallback((d: TableDraft) => tableMapper(node.id, d), [node.id]);
  const { form, draft, candidate, errorFor, hasErrorsUnder, submit, generalErrors } = useDraftForm<TableDraft>({
    nodeId: node.id,
    defaultValues,
    build,
    mapper,
  });
  const { register, control } = form;
  const columns = useFieldArray({ control, name: 'columns', keyName: 'key' });
  const indexes = useFieldArray({ control, name: 'indexes', keyName: 'key' });
  const [tab, setTab] = useState('columns');
  const dialect = useCanvasStore((s) => s.doc.database.dialect);

  const options = useMemo(() => referenceOptions(candidate, node.id, draft), [candidate, node.id, draft]);
  const ddl = useMemo(() => {
    const table = candidate.nodes.find((n): n is TableNode => n.id === node.id && n.type === 'table');
    return table ? tableToDdl(table, candidate) : '';
  }, [candidate, node.id]);

  const save = () =>
    submit((d) => {
      const { node: table, refs } = fromTableDraft(node, d);
      useCanvasStore.getState().editNode(table, refs);
      onClose();
    });

  const focusIndex = focusColumnId ? defaultValues.columns.findIndex((c) => c.id === focusColumnId) : -1;

  return (
    <Modal
      title="Edit table"
      width="max-w-5xl"
      onClose={onClose}
      initialFocus={focusIndex >= 0 ? () => form.setFocus(`columns.${focusIndex}.ref`) : undefined}
      footer={<DialogFooter errors={generalErrors} onCancel={onClose} onSave={save} />}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="mb-4 grid grid-cols-[1fr_12rem] gap-3">
          <Field label="Table name" error={errorFor('label')}>
            <input {...register('label')} className={`${controlClass} font-mono`} autoComplete="off" />
          </Field>
          <Field label="Schema" error={errorFor('schema')}>
            <input {...register('schema')} className={`${controlClass} font-mono`} placeholder="public" />
          </Field>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabList>
            <Tab value="columns" alert={hasErrorsUnder('columns.')}>
              Columns
            </Tab>
            <Tab value="indexes" alert={hasErrorsUnder('indexes.')}>
              Indexes
            </Tab>
            <Tab value="sql">SQL</Tab>
          </TabList>

          <TabPanel value="columns">
            <datalist id="fc-sql-types">
              {DIALECTS[dialect].types.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <table className="w-full border-separate border-spacing-x-1 border-spacing-y-1 text-left">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="w-12" />
                  <th className="font-medium">Name</th>
                  <th className="font-medium">Type</th>
                  <th className="w-9 text-center font-medium" title="Primary key">
                    PK
                  </th>
                  <th className="w-9 text-center font-medium" title="Nullable">
                    Null
                  </th>
                  <th className="w-9 text-center font-medium" title="Unique">
                    Uniq
                  </th>
                  <th className="font-medium">Default</th>
                  <th className="font-medium">References</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {columns.fields.map((field, i) => {
                  const column = draft.columns?.[i];
                  const name = column?.name || `column ${i + 1}`;
                  return (
                    <tr key={field.key} className="align-top">
                      <td className="whitespace-nowrap">
                        <IconAction label={`Move ${name} up`} disabled={i === 0} onClick={() => columns.swap(i, i - 1)}>
                          <ChevronUp className="size-3.5" />
                        </IconAction>
                        <IconAction
                          label={`Move ${name} down`}
                          disabled={i === columns.fields.length - 1}
                          onClick={() => columns.swap(i, i + 1)}
                        >
                          <ChevronDown className="size-3.5" />
                        </IconAction>
                      </td>
                      <td>
                        <input
                          {...register(`columns.${i}.name`)}
                          aria-label="Column name"
                          aria-invalid={errorFor(`columns.${i}.name`) ? true : undefined}
                          className={cell}
                          autoComplete="off"
                        />
                        <FieldError message={errorFor(`columns.${i}.name`)} />
                      </td>
                      <td>
                        <input
                          {...register(`columns.${i}.type`)}
                          aria-label={`Type of ${name}`}
                          aria-invalid={errorFor(`columns.${i}.type`) ? true : undefined}
                          list="fc-sql-types"
                          className={cell}
                        />
                        <FieldError message={errorFor(`columns.${i}.type`)} />
                      </td>
                      <td className="pt-1.5 text-center">
                        <input
                          type="checkbox"
                          {...register(`columns.${i}.primaryKey`)}
                          aria-label={`${name} is primary key`}
                          className={checkboxClass}
                        />
                      </td>
                      <td className="pt-1.5 text-center">
                        <input
                          type="checkbox"
                          {...register(`columns.${i}.nullable`)}
                          aria-label={`${name} is nullable`}
                          disabled={column?.primaryKey}
                          className={checkboxClass}
                        />
                      </td>
                      <td className="pt-1.5 text-center">
                        <input
                          type="checkbox"
                          {...register(`columns.${i}.unique`)}
                          aria-label={`${name} is unique`}
                          className={checkboxClass}
                        />
                      </td>
                      <td>
                        <input
                          {...register(`columns.${i}.default`)}
                          aria-label={`Default of ${name}`}
                          className={cell}
                          placeholder="—"
                        />
                        <FieldError message={errorFor(`columns.${i}.default`)} />
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <select
                            {...register(`columns.${i}.ref`)}
                            aria-label={`${name} references`}
                            aria-invalid={errorFor(`columns.${i}.ref`) ? true : undefined}
                            className={cell}
                          >
                            <option value="">—</option>
                            {options
                              .filter((o) => o.value !== `${node.id}::${column?.id}`)
                              .map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                          </select>
                          {column?.ref && (
                            <select
                              {...register(`columns.${i}.onDelete`)}
                              aria-label={`On delete for ${name}`}
                              title="On delete"
                              className={`${cell} w-28`}
                            >
                              {ON_DELETE.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <FieldError message={errorFor(`columns.${i}.ref`)} />
                      </td>
                      <td>
                        <IconAction label={`Remove ${name}`} onClick={() => columns.remove(i)}>
                          <Trash2 className="size-3.5" />
                        </IconAction>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Button variant="ghost" className="mt-2" onClick={() => columns.append(newColumnDraft())}>
              <Plus className="size-4" /> Add column
            </Button>
          </TabPanel>

          <TabPanel value="indexes">
            {indexes.fields.length === 0 && <p className="mb-2 text-text-muted">No indexes yet.</p>}
            <ul className="grid gap-2">
              {indexes.fields.map((field, i) => (
                <li key={field.key} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center gap-3">
                    <input
                      {...register(`indexes.${i}.name`)}
                      aria-label="Index name"
                      placeholder="auto-named"
                      className={`${cell} max-w-64`}
                    />
                    <label className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" {...register(`indexes.${i}.unique`)} className={checkboxClass} />
                      Unique
                    </label>
                    <span className="flex-1" />
                    <IconAction label="Remove index" onClick={() => indexes.remove(i)}>
                      <Trash2 className="size-3.5" />
                    </IconAction>
                  </div>
                  <Controller
                    control={control}
                    name={`indexes.${i}.columnIds`}
                    render={({ field: { value, onChange } }) => (
                      <div role="group" aria-label="Index columns" className="mt-2 flex flex-wrap gap-1.5">
                        {(draft.columns ?? []).map((c) => {
                          const on = value.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              aria-pressed={on}
                              onClick={() => onChange(on ? value.filter((id) => id !== c.id) : [...value, c.id])}
                              className={`rounded border px-2 py-0.5 font-mono text-xs ${
                                on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-text-muted hover:text-text'
                              }`}
                            >
                              {c.name || '(unnamed)'}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                  <FieldError message={errorFor(`indexes.${i}.columnIds`)} />
                </li>
              ))}
            </ul>
            <Button variant="ghost" className="mt-2" onClick={() => indexes.append(newIndexDraft())}>
              <Plus className="size-4" /> Add index
            </Button>
          </TabPanel>

          <TabPanel value="sql">
            <p className="mb-2 text-xs text-text-muted">
              {DIALECTS[dialect].label}, the project database. Change it in DB Schema.
            </p>
            <pre
              aria-label="Generated SQL"
              className="overflow-auto rounded-lg border border-border bg-canvas p-3 font-mono text-xs leading-relaxed"
            >
              {ddl}
            </pre>
          </TabPanel>
        </Tabs>
        <BaselineChanges candidate={candidate} itemRef={{ kind: 'node', id: node.id }} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
