import {
  convertDocDialect,
  DIALECTS,
  featureAnnotations,
  SCHEMA_EXPORTS,
  SQL_DIALECTS,
  SqlDialect,
  type SchemaExportFormat,
} from '@flowcanvas/shared';
import { Check, Copy, Download, Link } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button, controlClass } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { CodeView } from './CodeView';
import { downloadText } from './download';
import { ScopePicker, scopeFeatureName, scopeParams, useExportScope, useScopedDoc } from './ScopePicker';

const FORMATS = Object.keys(SCHEMA_EXPORTS) as SchemaExportFormat[];

const HINTS: Record<SchemaExportFormat, string> = {
  dbml: 'Paste into dbdiagram.io, or hand to an AI as the data model.',
  mermaid: 'Renders in GitHub/GitLab markdown inside a ```mermaid block.',
  sql: 'Runnable script for the project database.',
};

/** Live database schema of the canvas tables: DBML, Mermaid ER or SQL */
export default function SchemaDialog({ onClose }: { onClose(): void }) {
  const doc = useCanvasStore((s) => s.doc);
  const projectId = useCanvasStore((s) => s.projectId);
  const saveState = useCanvasStore((s) => s.saveState);
  const [format, setFormat] = useState<SchemaExportFormat>('dbml');
  const [copied, setCopied] = useState<'schema' | 'url' | null>(null);
  const saved = doc.database.dialect;
  const [dialect, setDialect] = useState<SqlDialect>(saved);

  const [scope, setScope] = useExportScope();
  const scoped = useScopedDoc(doc, scope);
  // Marks per table and column; read from the unconverted doc, so a dialect preview isn't a change
  const feature = useMemo(() => (scoped.featureId ? (featureAnnotations(doc, scoped.featureId) ?? undefined) : undefined), [doc, scoped.featureId]);

  // The preview follows the picked database, showing the tables as they'd be converted
  const preview = useMemo(() => convertDocDialect(scoped.doc, dialect), [scoped.doc, dialect]);
  const exporter = SCHEMA_EXPORTS[format];
  const text = useMemo(() => exporter.render(preview, { feature }), [exporter, preview, feature]);
  const hasTables = scoped.doc.nodes.some((n) => n.type === 'table');
  const query = new URLSearchParams({
    ...(exporter.dialectAware && dialect !== saved && { dialect }),
    ...scopeParams(scope),
  }).toString();
  const liveUrl = projectId
    ? `${window.location.origin}/api/projects/${projectId}/schema.${exporter.extension}${query ? `?${query}` : ''}`
    : '';
  const featureName = scopeFeatureName(doc, scope);
  const fileBase = featureName ? `schema-${featureName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 'schema';

  const copy = async (what: 'schema' | 'url', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Modal
      title="Database schema"
      description="Generated live from the canvas tables and foreign keys"
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
        <section className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <label htmlFor="fc-db-dialect" className="font-medium">
            Project database
          </label>
          <select
            id="fc-db-dialect"
            value={dialect}
            onChange={(e) => setDialect(SqlDialect.parse(e.target.value))}
            className={`${controlClass} w-40`}
          >
            {SQL_DIALECTS.map((d) => (
              <option key={d} value={d}>
                {DIALECTS[d].label}
              </option>
            ))}
          </select>
          <span className="flex-1 text-xs text-text-muted">
            {dialect === saved
              ? 'Sets the SQL dialect and the column type suggestions.'
              : `Preview: column types and defaults converted from ${DIALECTS[saved].label}.`}
          </span>
          {dialect !== saved && (
            <>
              <Button className="px-2 py-1 text-xs" onClick={() => setDialect(saved)}>
                Discard
              </Button>
              <Button
                variant="primary"
                className="px-2 py-1 text-xs"
                onClick={() => useCanvasStore.getState().setDatabaseDialect(dialect)}
              >
                Convert tables to {DIALECTS[dialect].label}
              </Button>
            </>
          )}
        </section>

        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Format" className="inline-flex rounded-md border border-border bg-surface p-0.5">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                onClick={() => setFormat(f)}
                className={`rounded px-3 py-1 text-xs ${format === f ? 'bg-accent/20 text-accent' : 'text-text-muted'}`}
              >
                {SCHEMA_EXPORTS[f].label}
              </button>
            ))}
          </div>
          <ScopePicker scope={scope} onChange={setScope} />
          <span className="flex-1 truncate text-xs text-text-muted">{HINTS[format]}</span>
          <Button className="px-2 py-1 text-xs" onClick={() => copy('schema', text)}>
            {copied === 'schema' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy
          </Button>
          <Button
            className="px-2 py-1 text-xs"
            onClick={() => downloadText(text, `${fileBase}.${exporter.extension}`, exporter.mimeType)}
          >
            <Download className="size-3.5" /> Download
          </Button>
          <Button className="px-2 py-1 text-xs" disabled={!liveUrl} onClick={() => copy('url', liveUrl)} title={liveUrl}>
            {copied === 'url' ? <Check className="size-3.5" /> : <Link className="size-3.5" />} Copy live URL
          </Button>
        </div>

        {!hasTables && (
          <p className="text-xs text-text-muted">
            {featureName ? `${featureName} has no tables.` : 'No tables on the canvas yet; add one with the table tool (T).'}
          </p>
        )}

        <div className="min-h-0 flex-1">
          <CodeView value={text} language="text" label={`Database schema (${exporter.label})`} />
        </div>
      </div>
    </Modal>
  );
}
