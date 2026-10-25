import { DIALECTS, parseCanvasFile, parseDbml, parseOpenApi, parseSqlSchema, SQL_DIALECTS, SqlDialect } from '@flowcanvas/shared';
import { FileUp, TriangleAlert } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button, checkboxClass, compactControlClass, controlClass } from '../components/ui/form';
import { buildApiImport, defaultApplySettings, importApi } from '../store/apiImportOps';
import { useCanvasStore } from '../store/canvasStore';
import { buildSchemaImport, importSchema } from '../store/importOps';
import { useUiStore } from '../store/uiStore';
import { OpenApiPreview, type OpenApiPreviewState } from './OpenApiPreview';

type Format = 'sql' | 'dbml' | 'openapi' | 'json';

const FORMATS: { value: Format; label: string; accept: string; placeholder: string }[] = [
  { value: 'sql', label: 'SQL', accept: '.sql,.ddl,.txt', placeholder: 'CREATE TABLE users (\n  id bigserial PRIMARY KEY,\n  email text NOT NULL UNIQUE\n);' },
  { value: 'dbml', label: 'DBML', accept: '.dbml,.txt', placeholder: 'Table users {\n  id bigint [pk, increment]\n  email text [not null, unique]\n}' },
  {
    value: 'openapi',
    label: 'OpenAPI',
    accept: '.yaml,.yml,.json',
    placeholder: 'openapi: 3.1.0\ninfo:\n  title: Shop API\n  version: 1.0.0\npaths:\n  /orders:\n    get:\n      responses:\n        "200":\n          description: Orders',
  },
  { value: 'json', label: 'JSON', accept: '.json', placeholder: 'Paste or open a RuneArch .json export' },
];

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** A JSON file is an OpenAPI document when it has an `openapi` or `swagger` key, else a RuneArch file */
function isOpenApiJson(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && ('openapi' in value || 'swagger' in value);
  } catch {
    return false;
  }
}

const formatOf = (fileName: string, text: string): Format | null =>
  /\.dbml$/i.test(fileName)
    ? 'dbml'
    : /\.ya?ml$/i.test(fileName)
      ? 'openapi'
      : /\.json$/i.test(fileName)
        ? isOpenApiJson(text)
          ? 'openapi'
          : 'json'
        : /\.(sql|ddl)$/i.test(fileName)
          ? 'sql'
          : null;

/**
 * Import into the canvas: database tables from SQL DDL or DBML (merged: existing tables are updated,
 * new ones laid out next to the canvas), endpoints and models from an OpenAPI document (merged the
 * same way, docs/openapi-import-plan.md), or a whole RuneArch JSON file (replaces the canvas).
 * Each is one undo step.
 */
export default function ImportDialog({ onClose }: { onClose(): void }) {
  const doc = useCanvasStore((s) => s.doc);
  const [format, setFormat] = useState<Format>('sql');
  const [text, setText] = useState('');
  const [dialect, setDialect] = useState<SqlDialect>(doc.database.dialect);
  const [busy, setBusy] = useState(false);
  // null: the default for this canvas (the spec's settings only when it has no endpoints yet)
  const [applySettingsChoice, setApplySettings] = useState<boolean | null>(null);
  const applySettings = applySettingsChoice ?? defaultApplySettings(doc);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = FORMATS.find((f) => f.value === format)!;

  // A live preview of what the import will do
  const schemaPreview = useMemo(() => {
    if (format === 'json' || format === 'openapi' || !text.trim()) return null;
    const schema = format === 'sql' ? parseSqlSchema(text, dialect) : parseDbml(text, doc.database.dialect);
    return { schema, result: buildSchemaImport(doc, schema, format === 'sql' ? dialect : undefined) };
  }, [format, text, dialect, doc]);
  const apiPreview = useMemo((): OpenApiPreviewState => {
    if (format !== 'openapi' || !text.trim()) return null;
    const parsed = parseOpenApi(text);
    return { parsed, result: parsed.ok ? { ...buildApiImport(doc, parsed.api, { applySettings }), api: parsed.api } : null };
  }, [format, text, doc, applySettings]);
  const file = useMemo(() => (format === 'json' && text.trim() ? parseCanvasFile(text) : null), [format, text]);

  const openFile = async (f: File | undefined) => {
    if (!f) return;
    const content = await f.text();
    const detected = formatOf(f.name, content);
    if (detected) setFormat(detected);
    setText(content);
  };

  const runSchemaImport = async () => {
    if (!schemaPreview) return;
    setBusy(true);
    const { doc: next, added, updated } = await importSchema(doc, schemaPreview.schema, format === 'sql' ? dialect : undefined);
    useCanvasStore.getState().applyImport(next);
    const ui = useUiStore.getState();
    const ids = [...added, ...updated];
    ui.setSelection(ids);
    ui.requestFit(ids);
    ui.showHint(`Imported ${ids.length} table${ids.length === 1 ? '' : 's'}`);
    onClose();
  };

  const formatHint =
    format === 'json'
      ? 'Replaces the whole canvas with the file.'
      : format === 'openapi'
        ? 'Same routes and model names are updated; new ones are added next to the canvas. Nothing is deleted.'
        : format === 'sql' && dialect !== doc.database.dialect
          ? `Types are converted from ${DIALECTS[dialect].label} to ${DIALECTS[doc.database.dialect].label}.`
          : 'Tables with the same name are updated; new ones are added next to the canvas.';

  const apiResult = apiPreview?.result;
  const apiChanges = apiResult ? apiResult.doc !== doc : false;
  const apiEndpoints = apiResult ? apiResult.endpoints.added.length + apiResult.endpoints.updated.length : 0;
  const apiButton = !apiResult ? 'Import' : !apiChanges ? 'Up to date' : apiEndpoints ? `Import ${plural(apiEndpoints, 'endpoint')}` : 'Import';
  const runApiImport = () => {
    if (!apiPreview?.parsed.ok) return;
    const { doc: next, endpoints, models } = importApi(doc, apiPreview.parsed.api, { applySettings });
    if (next === doc) return;
    useCanvasStore.getState().applyImport(next);
    const ui = useUiStore.getState();
    const ids = [...endpoints.added, ...endpoints.updated];
    ui.setSelection(ids);
    ui.requestFit(ids);
    const modelCount = models.added.length + models.updated.length;
    const counts = [ids.length && plural(ids.length, 'endpoint'), modelCount && plural(modelCount, 'model')].filter(Boolean);
    ui.showHint(counts.length ? `Imported ${counts.join(' and ')}` : 'Imported the API settings');
    onClose();
  };

  const replaceCanvas = () => {
    if (!file?.ok) return;
    useCanvasStore.getState().applyImport(file.doc);
    useUiStore.getState().setSelection([]);
    useUiStore.getState().requestFit();
    useUiStore.getState().showHint('Canvas replaced. Ctrl+Z brings the previous one back');
    onClose();
  };

  const tables = schemaPreview?.schema.tables ?? [];
  const willImport = tables.length > 0;

  return (
    <Modal
      title="Import"
      description="Add database tables from SQL or DBML, endpoints and models from OpenAPI, or open a RuneArch JSON file"
      width="max-w-5xl"
      onClose={onClose}
      footer={
        <>
          <p className="flex-1 text-xs text-text-muted">Undo (Ctrl+Z) reverts the whole import.</p>
          <Button onClick={onClose}>Cancel</Button>
          {format === 'json' ? (
            <Button variant="primary" disabled={!file?.ok} onClick={replaceCanvas}>
              Replace canvas
            </Button>
          ) : format === 'openapi' ? (
            <Button variant="primary" disabled={!apiChanges || Boolean(apiResult?.issues.length)} onClick={runApiImport}>
              {apiButton}
            </Button>
          ) : (
            <Button variant="primary" disabled={!willImport || busy} onClick={() => void runSchemaImport()}>
              {willImport ? `Import ${tables.length} table${tables.length === 1 ? '' : 's'}` : 'Import'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex h-[60vh] flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Format" className="inline-flex rounded-md border border-border bg-surface p-0.5">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={format === f.value}
                onClick={() => setFormat(f.value)}
                className={`rounded px-3 py-1 text-xs ${format === f.value ? 'bg-accent/20 text-accent' : 'text-text-muted'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {format === 'sql' && (
            <select
              aria-label="Written for"
              value={dialect}
              onChange={(e) => setDialect(SqlDialect.parse(e.target.value))}
              className={`${compactControlClass} w-40`}
            >
              {SQL_DIALECTS.map((d) => (
                <option key={d} value={d}>
                  {DIALECTS[d].label}
                </option>
              ))}
            </select>
          )}
          {format === 'openapi' && (
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={applySettings}
                onChange={(e) => setApplySettings(e.target.checked)}
              />
              Use the spec's title, version, servers and auth
            </label>
          )}
          <Button className="px-2 py-1 text-xs" onClick={() => fileRef.current?.click()}>
            <FileUp className="size-3.5" /> Open file…
          </Button>
          <input
            ref={fileRef}
            type="file"
            hidden
            aria-label="Import file"
            accept={FORMATS.map((f) => f.accept).join(',')}
            onChange={(e) => {
              void openFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <span className="flex-1 truncate text-xs text-text-muted" title={formatHint}>
            {formatHint}
          </span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] gap-3">
          <textarea
            aria-label={`${current.label} to import`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void openFile(e.dataTransfer.files[0]);
            }}
            placeholder={current.placeholder}
            spellCheck={false}
            className={`${controlClass} h-full resize-none font-mono text-xs`}
          />
          <section aria-label="Preview" className="min-h-0 overflow-y-auto rounded-lg border border-border p-3 text-xs">
            {format === 'json' ? (
              <JsonPreview file={file} />
            ) : format === 'openapi' ? (
              <OpenApiPreview preview={apiPreview} doc={doc} />
            ) : (
              <SchemaPreview preview={schemaPreview} />
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}

function SchemaPreview({ preview }: { preview: { result: ReturnType<typeof buildSchemaImport> } | null }) {
  if (!preview) return <p className="text-text-muted">Paste a script or open a file to see what will be imported.</p>;
  const { doc, added, updated, refs, warnings } = preview.result;
  const tables = doc.nodes.filter((n) => added.includes(n.id) || updated.includes(n.id));
  return (
    <div className="grid gap-3">
      <p>
        <strong>{added.length}</strong> new, <strong>{updated.length}</strong> updated table{updated.length === 1 ? '' : 's'},{' '}
        <strong>{refs}</strong> new foreign key{refs === 1 ? '' : 's'}
      </p>
      {tables.length > 0 && (
        <ul className="grid gap-1">
          {tables.map((t) => (
            <li key={t.id} className="flex items-center gap-2 font-mono">
              <span className="min-w-0 flex-1 truncate">
                {t.type === 'table' && t.data.schema !== 'public' ? `${t.data.schema}.` : ''}
                {t.label}
              </span>
              <span className="text-text-muted">{t.type === 'table' ? t.data.columns.length : 0} cols</span>
              <span className={`rounded px-1 ${added.includes(t.id) ? 'bg-node-db/20 text-node-db' : 'bg-accent/15 text-accent'}`}>
                {added.includes(t.id) ? 'new' : 'update'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Warnings items={warnings} />
    </div>
  );
}

function JsonPreview({ file }: { file: ReturnType<typeof parseCanvasFile> | null }) {
  if (!file) return <p className="text-text-muted">Paste or open a RuneArch .json export.</p>;
  if (!file.ok) return <Warnings title={file.error} items={file.issues} danger />;
  const { nodes, edges, flows, models } = file.doc;
  return (
    <ul className="grid gap-1">
      <li>
        <strong>{nodes.length}</strong> nodes, <strong>{edges.length}</strong> connections
      </li>
      <li>
        <strong>{flows.length}</strong> flows, <strong>{models.length}</strong> API models
      </li>
      <li className="mt-2 text-text-muted">The current canvas is replaced; Ctrl+Z brings it back.</li>
    </ul>
  );
}

function Warnings({ items, title, danger }: { items: string[]; title?: string; danger?: boolean }) {
  if (!items.length && !title) return null;
  return (
    <div className={`grid gap-1 ${danger ? 'text-danger' : 'text-warning'}`}>
      {title && (
        <p className="flex items-center gap-1.5 font-medium">
          <TriangleAlert className="size-3.5 shrink-0" /> {title}
        </p>
      )}
      <ul className="grid gap-1">
        {items.map((w, i) => (
          <li key={i} className="flex gap-1.5">
            {!title && <TriangleAlert className="mt-0.5 size-3 shrink-0" />}
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
