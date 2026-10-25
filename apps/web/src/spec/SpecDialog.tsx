import { specToYaml, toScopedOpenApi, type ApiSettings } from '@flowcanvas/shared';
import { Check, ChevronDown, ChevronRight, Copy, Download, Link, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Modal } from '../components/ui/Modal';
import { Button, checkboxClass, controlClass, Field, IconAction } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { CodeView } from './CodeView';
import { downloadText } from './download';
import { ScopePicker, scopeFeatureName, scopeParams, toExportScope, useExportScope } from './ScopePicker';

type Format = 'json' | 'yaml';

type SettingsDraft = {
  title: string;
  version: string;
  description: string;
  auth: ApiSettings['auth'];
  apiKeyHeader: string;
  servers: { url: string; description: string }[];
};

const toDraft = (api: ApiSettings): SettingsDraft => ({
  title: api.title,
  version: api.version,
  description: api.description ?? '',
  auth: api.auth,
  apiKeyHeader: api.apiKeyHeader,
  servers: api.servers.map((s) => ({ url: s.url, description: s.description ?? '' })),
});

const fromDraft = (d: SettingsDraft): ApiSettings => ({
  title: d.title.trim(),
  version: d.version.trim(),
  description: d.description.trim() || undefined,
  auth: d.auth,
  apiKeyHeader: d.apiKeyHeader.trim() || 'X-API-Key',
  servers: d.servers
    .filter((s) => s.url.trim())
    .map((s) => ({ url: s.url.trim(), description: s.description.trim() || undefined })),
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'api';

/** Live OpenAPI preview of the canvas, with the API settings (ARCHITECTURE.md §8.6) */
export default function SpecDialog({ onClose }: { onClose(): void }) {
  const doc = useCanvasStore((s) => s.doc);
  const projectId = useCanvasStore((s) => s.projectId);
  const saveState = useCanvasStore((s) => s.saveState);
  const [format, setFormat] = useState<Format>('yaml');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState<'spec' | 'url' | null>(null);
  const [scope, setScope] = useExportScope();
  const [onlyChanges, setOnlyChanges] = useState(false);
  const featureName = scopeFeatureName(doc, scope);

  const form = useForm<SettingsDraft>({ defaultValues: toDraft(doc.api) });
  const settings = useWatch({ control: form.control }) as SettingsDraft;
  const servers = useFieldArray({ control: form.control, name: 'servers' });

  // The preview follows the settings draft, so changes show before they're applied
  const api = useMemo(() => fromDraft(settings), [settings]);
  const spec = useMemo(() => {
    try {
      const preview = { ...doc, api };
      // A scope naming a deleted feature falls back to the whole project
      const exportScope = featureName ? toExportScope(scope) : toExportScope({ ...scope, featureId: '' });
      const json = toScopedOpenApi(preview, exportScope, { onlyChanges: featureName !== undefined && onlyChanges })!;
      return { text: format === 'json' ? `${JSON.stringify(json, null, 2)}` : specToYaml(json) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [doc, api, format, scope, featureName, onlyChanges]);

  const query = new URLSearchParams({ ...scopeParams(scope), ...(featureName && onlyChanges && { only: 'changes' }) }).toString();
  const liveUrl = projectId ? `${window.location.origin}/api/projects/${projectId}/openapi.${format}${query ? `?${query}` : ''}` : '';

  const copy = async (what: 'spec' | 'url', text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  const download = () => {
    if (!spec.text) return;
    const base = featureName ? `${slug(api.title)}-${slug(featureName)}` : slug(api.title);
    downloadText(spec.text, `${base}.openapi.${format}`, format === 'json' ? 'application/json' : 'application/yaml');
  };

  const apply = () => {
    const next = fromDraft(form.getValues());
    useCanvasStore.getState().updateApiSettings(next);
    form.reset(toDraft(next));
  };

  return (
    <Modal
      title="API spec"
      description="OpenAPI 3.1, generated live from the canvas"
      width="max-w-5xl"
      onClose={onClose}
      footer={
        <>
          <p className="flex-1 text-xs text-text-muted">
            {saveState === 'saved'
              ? 'The live URL serves the saved canvas.'
              : 'The live URL serves the last saved version; unsaved changes appear once saved.'}
          </p>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex h-[65vh] flex-col gap-3">
        <section className="rounded-lg border border-border">
          <button
            type="button"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-medium"
          >
            {settingsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            API settings
            <span className="ml-2 truncate font-normal text-text-muted">
              {api.title} · v{api.version} · auth: {api.auth}
            </span>
          </button>
          {settingsOpen && (
            <form
              className="grid gap-3 border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                apply();
              }}
            >
              <div className="grid grid-cols-[1fr_8rem_10rem] gap-3">
                <Field label="Title">
                  <input {...form.register('title')} className={controlClass} />
                </Field>
                <Field label="Version">
                  <input {...form.register('version')} className={`${controlClass} font-mono`} />
                </Field>
                <Field label="Auth">
                  <select {...form.register('auth')} className={controlClass}>
                    <option value="bearer">Bearer (JWT)</option>
                    <option value="apiKey">API key</option>
                    <option value="none">None</option>
                  </select>
                </Field>
              </div>
              {settings.auth === 'apiKey' && (
                <Field label="API key header">
                  <input {...form.register('apiKeyHeader')} className={`${controlClass} font-mono`} />
                </Field>
              )}
              <Field label="Description">
                <input {...form.register('description')} className={controlClass} />
              </Field>
              <div>
                <span className="mb-1 block text-xs font-medium text-text-muted">Servers</span>
                <ul className="grid gap-1.5">
                  {servers.fields.map((s, i) => (
                    <li key={s.id} className="flex gap-2">
                      <input
                        {...form.register(`servers.${i}.url`)}
                        aria-label="Server URL"
                        placeholder="https://api.example.com"
                        className={`${controlClass} font-mono`}
                      />
                      <input
                        {...form.register(`servers.${i}.description`)}
                        aria-label="Server description"
                        placeholder="Production"
                        className={controlClass}
                      />
                      <IconAction label="Remove server" onClick={() => servers.remove(i)}>
                        <Trash2 className="size-3.5" />
                      </IconAction>
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" className="mt-1 px-2 py-1 text-xs" onClick={() => servers.append({ url: '', description: '' })}>
                  <Plus className="size-3.5" /> Server
                </Button>
              </div>
              <div className="flex justify-end gap-2">
                <Button disabled={!form.formState.isDirty} onClick={() => form.reset()}>
                  Discard
                </Button>
                <Button type="submit" variant="primary" disabled={!form.formState.isDirty}>
                  Apply settings
                </Button>
              </div>
            </form>
          )}
        </section>

        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Format" className="inline-flex rounded-md border border-border bg-surface p-0.5">
            {(['yaml', 'json'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                onClick={() => setFormat(f)}
                className={`rounded px-3 py-1 text-xs uppercase ${format === f ? 'bg-accent/20 text-accent' : 'text-text-muted'}`}
              >
                {f}
              </button>
            ))}
          </div>
          <ScopePicker scope={scope} onChange={setScope} />
          {featureName && (
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              <input type="checkbox" className={checkboxClass} checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
              Only new, changed and removed endpoints
            </label>
          )}
          <span className="flex-1" />
          <Button className="px-2 py-1 text-xs" disabled={!spec.text} onClick={() => copy('spec', spec.text!)}>
            {copied === 'spec' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy
          </Button>
          <Button className="px-2 py-1 text-xs" disabled={!spec.text} onClick={download}>
            <Download className="size-3.5" /> Download
          </Button>
          <Button className="px-2 py-1 text-xs" disabled={!liveUrl} onClick={() => copy('url', liveUrl)} title={liveUrl}>
            {copied === 'url' ? <Check className="size-3.5" /> : <Link className="size-3.5" />} Copy live URL
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          {spec.text !== undefined ? (
            <CodeView value={spec.text} language={format} label={`OpenAPI spec (${format.toUpperCase()})`} />
          ) : (
            <p role="alert" className="text-danger">
              Can’t generate the spec: {spec.error}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
