import { defaultOperationId, HttpMethod, statusText } from '@flowcanvas/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFieldArray } from 'react-hook-form';
import type { NodeOf } from '../canvas/mapping';
import { TypePicker } from '../components/TypePicker';
import { Modal } from '../components/ui/Modal';
import { Tab, TabList, TabPanel, Tabs } from '../components/ui/Tabs';
import { Button, checkboxClass, controlClass, Field, FieldError, IconAction } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { DialogFooter } from './DialogFooter';
import {
  endpointMapper,
  fromEndpointDraft,
  newParamDraft,
  newResponseDraft,
  syncParamDrafts,
  toEndpointDraft,
  withNode,
  type EndpointDraft,
} from './drafts';
import { useDraftForm } from './useDraftForm';
import { BaselineChanges } from '../features/ChangeList';

const mapper = () => endpointMapper;
const cell = `${controlClass} px-2 py-1 text-xs`;

const AUTH: { value: EndpointDraft['auth']; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

/** Status chip colors: 2xx green, 4xx amber, 5xx red */
const statusTone = (status: string | undefined) =>
  status?.startsWith('2')
    ? 'border-method-get/60 text-method-get'
    : status?.startsWith('4')
      ? 'border-warning/60 text-warning'
      : status?.startsWith('5')
        ? 'border-danger/60 text-danger'
        : '';

export function EndpointDialog({ node, onClose }: { node: NodeOf<'endpoint'>; onClose(): void }) {
  const build = useMemo(() => withNode(node, fromEndpointDraft), [node]);
  const { form, draft, candidate, errorFor, hasErrorsUnder, submit, generalErrors } = useDraftForm<EndpointDraft>({
    nodeId: node.id,
    defaultValues: toEndpointDraft(node),
    build,
    mapper,
  });
  const { register, control } = form;
  const params = useFieldArray({ control, name: 'params', keyName: 'key' });
  const responses = useFieldArray({ control, name: 'responses', keyName: 'key' });
  const [tab, setTab] = useState('general');
  const models = candidate.models;

  // Path params follow {...} in the path while typing
  const path = draft.path ?? '';
  useEffect(() => {
    const current = form.getValues('params');
    const synced = syncParamDrafts(path, current);
    if (synced.map((p) => p.id).join() !== current.map((p) => p.id).join()) params.replace(synced);
  }, [path, form, params]);

  const save = () =>
    submit((d) => {
      useCanvasStore.getState().editNode(fromEndpointDraft(node, d));
      onClose();
    });

  const generalError =
    hasErrorsUnder('method') || hasErrorsUnder('path') || hasErrorsUnder('operationId') || hasErrorsUnder('summary');

  return (
    <Modal
      title="Edit endpoint"
      width="max-w-4xl"
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
            <Tab value="general" alert={generalError}>
              General
            </Tab>
            <Tab value="params" alert={hasErrorsUnder('params.')}>
              Params
            </Tab>
            <Tab value="body" alert={hasErrorsUnder('body.')}>
              Body
            </Tab>
            <Tab value="responses" alert={hasErrorsUnder('responses')}>
              Responses
            </Tab>
          </TabList>

          <TabPanel value="general">
            <div className="grid gap-4">
              <div className="grid grid-cols-[8rem_1fr] gap-3">
                <Field label="Method" error={errorFor('method')}>
                  <select {...register('method')} className={`${controlClass} font-mono`}>
                    {HttpMethod.options.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Path" error={errorFor('path')} hint="Use {name} for path parameters, e.g. /orders/{orderId}">
                  <input {...register('path')} className={`${controlClass} font-mono`} autoComplete="off" />
                </Field>
              </div>
              <Field label="Summary" error={errorFor('summary')}>
                <input {...register('summary')} className={controlClass} placeholder="Create an order" />
              </Field>
              <Field label="Description" error={errorFor('description')}>
                <textarea {...register('description')} rows={3} className={controlClass} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tags" hint="Comma-separated, e.g. orders, checkout" error={errorFor('tags')}>
                  <input {...register('tags')} className={controlClass} />
                </Field>
                <Field label="Operation ID" error={errorFor('operationId')}>
                  <input
                    {...register('operationId')}
                    className={`${controlClass} font-mono`}
                    placeholder={defaultOperationId(draft.method ?? 'GET', path)}
                    autoComplete="off"
                  />
                </Field>
              </div>
              <div className="flex items-end gap-6">
                <fieldset>
                  <legend className="mb-1 text-xs font-medium text-text-muted">Auth</legend>
                  <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
                    {AUTH.map((a) => (
                      <label
                        key={a.value}
                        className="cursor-pointer rounded px-3 py-1 text-text-muted has-checked:bg-accent/20 has-checked:text-accent has-focus-visible:ring-2 has-focus-visible:ring-accent"
                      >
                        <input type="radio" value={a.value} {...register('auth')} className="sr-only" />
                        {a.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex items-center gap-2 pb-1.5">
                  <input type="checkbox" {...register('deprecated')} className={checkboxClass} />
                  Deprecated
                </label>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="params">
            <table className="w-full border-separate border-spacing-x-1 border-spacing-y-1 text-left">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="font-medium">Name</th>
                  <th className="w-24 font-medium">In</th>
                  <th className="font-medium">Type</th>
                  <th className="w-9 text-center font-medium" title="Required">
                    Req
                  </th>
                  <th className="font-medium">Description</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {params.fields.map((p, i) => {
                  const inPath = p.in === 'path';
                  const name = draft.params?.[i]?.name || `param ${i + 1}`;
                  return (
                    <tr key={p.key} className="align-top">
                      <td>
                        {inPath ? (
                          <span className="block px-2 py-1 font-mono text-xs" title="From the path">
                            {p.name}
                          </span>
                        ) : (
                          <input
                            {...register(`params.${i}.name`)}
                            aria-label="Parameter name"
                            aria-invalid={errorFor(`params.${i}.name`) ? true : undefined}
                            className={`${cell} font-mono`}
                            autoComplete="off"
                          />
                        )}
                        <FieldError message={errorFor(`params.${i}.name`)} />
                      </td>
                      <td>
                        {inPath ? (
                          <span className="block px-2 py-1 text-xs text-text-muted">path</span>
                        ) : (
                          <select {...register(`params.${i}.in`)} aria-label={`Location of ${name}`} className={cell}>
                            <option value="query">query</option>
                            <option value="header">header</option>
                          </select>
                        )}
                      </td>
                      <td>
                        <TypePicker
                          name={`params.${i}.type`}
                          value={draft.params?.[i]?.type}
                          register={register}
                          models={models}
                          label={`Type of ${name}`}
                          primitiveOnly
                        />
                      </td>
                      <td className="pt-1.5 text-center">
                        <input
                          type="checkbox"
                          {...register(`params.${i}.required`)}
                          aria-label={`${name} is required`}
                          disabled={inPath}
                          className={checkboxClass}
                        />
                      </td>
                      <td>
                        <input {...register(`params.${i}.description`)} aria-label={`Description of ${name}`} className={cell} />
                      </td>
                      <td>
                        {!inPath && (
                          <IconAction label={`Remove ${name}`} onClick={() => params.remove(i)}>
                            <Trash2 className="size-3.5" />
                          </IconAction>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {params.fields.length === 0 && <p className="mb-2 text-text-muted">No parameters.</p>}
            <p className="mb-2 text-xs text-text-muted">Path parameters come from {'{…}'} in the path.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => params.append(newParamDraft('', 'query'))}>
                <Plus className="size-4" /> Query param
              </Button>
              <Button variant="ghost" onClick={() => params.append(newParamDraft('', 'header'))}>
                <Plus className="size-4" /> Header
              </Button>
            </div>
          </TabPanel>

          <TabPanel value="body">
            <label className="mb-3 flex items-center gap-2">
              <input type="checkbox" {...register('hasBody')} className={checkboxClass} />
              This endpoint takes a request body
            </label>
            {draft.hasBody && (
              <div className="grid gap-4">
                {(draft.method === 'GET' || draft.method === 'DELETE') && (
                  <p className="text-xs text-warning">Request bodies on {draft.method} are unusual; many clients drop them.</p>
                )}
                <div>
                  <span className="mb-1 block text-xs font-medium text-text-muted">Type</span>
                  <TypePicker
                    name="body.type"
                    value={draft.body?.type}
                    register={register}
                    models={models}
                    label="Body type"
                    invalid={!!errorFor('body.type.base')}
                  />
                  <FieldError message={errorFor('body.type.base')} />
                </div>
                <div className="grid grid-cols-[1fr_auto] items-end gap-4">
                  <Field label="Content type">
                    <input {...register('body.contentType')} className={`${controlClass} font-mono`} />
                  </Field>
                  <label className="flex items-center gap-2 pb-1.5">
                    <input type="checkbox" {...register('body.required')} className={checkboxClass} />
                    Required
                  </label>
                </div>
              </div>
            )}
          </TabPanel>

          <TabPanel value="responses">
            <ul className="grid gap-2">
              {responses.fields.map((r, i) => {
                const response = draft.responses?.[i];
                const status = response?.status || `response ${i + 1}`;
                return (
                  <li key={r.key} className="rounded-lg border border-border bg-surface p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="w-24">
                        <input
                          {...register(`responses.${i}.status`)}
                          aria-label="Status"
                          aria-invalid={errorFor(`responses.${i}.status`) ? true : undefined}
                          className={`${cell} font-mono font-semibold ${statusTone(response?.status)}`}
                          autoComplete="off"
                        />
                      </div>
                      <input
                        {...register(`responses.${i}.description`)}
                        aria-label={`Description of ${status}`}
                        placeholder={response?.status ? statusText(response.status) : 'Description'}
                        className={cell}
                      />
                      <IconAction label={`Remove ${status}`} onClick={() => responses.remove(i)}>
                        <Trash2 className="size-3.5" />
                      </IconAction>
                    </div>
                    <FieldError message={errorFor(`responses.${i}.status`)} />
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-0.5">
                      <label className="flex items-center gap-1.5 text-xs text-text-muted">
                        <input type="checkbox" {...register(`responses.${i}.hasBody`)} className={checkboxClass} />
                        Body
                      </label>
                      {response?.hasBody && (
                        <TypePicker
                          name={`responses.${i}.body`}
                          value={response.body}
                          register={register}
                          models={models}
                          label={`Body of ${status}`}
                          invalid={!!errorFor(`responses.${i}.body.base`)}
                        />
                      )}
                    </div>
                    <FieldError message={errorFor(`responses.${i}.body.base`)} />
                  </li>
                );
              })}
            </ul>
            <FieldError message={errorFor('responses')} />
            <Button
              variant="ghost"
              className="mt-2"
              onClick={() => responses.append(newResponseDraft(responses.fields.length ? '' : '200'))}
            >
              <Plus className="size-4" /> Add response
            </Button>
          </TabPanel>
        </Tabs>
        <BaselineChanges candidate={candidate} itemRef={{ kind: 'node', id: node.id }} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
