import { CODE_EXPORTS, CODE_TARGETS, DIALECTS, type CodeTarget } from '@flowcanvas/shared';
import { Check, Copy, Download, Link } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { CodeView } from './CodeView';
import { downloadText } from './download';
import { ScopePicker, scopeFeatureName, scopeParams, useExportScope, useScopedDoc } from './ScopePicker';

/** What each code source is called, and how to add one */
const SOURCES = {
  models: { label: 'API models', nodeType: undefined, empty: 'No API models yet; add one in the API side panel.' },
  tables: { label: 'tables', nodeType: 'table', empty: 'No tables on the canvas yet; add one with the table tool (T).' },
  endpoints: { label: 'endpoints', nodeType: 'endpoint', empty: 'No endpoints on the canvas yet; add one with the endpoint tool (E).' },
} as const;

/** Live code generated from the canvas: Pydantic, SQLAlchemy, SQLModel, FastAPI, Zod, Drizzle or Prisma */
export default function CodeDialog({ onClose }: { onClose(): void }) {
  const doc = useCanvasStore((s) => s.doc);
  const projectId = useCanvasStore((s) => s.projectId);
  const saveState = useCanvasStore((s) => s.saveState);
  const [target, setTarget] = useState<CodeTarget>('pydantic');
  const [copied, setCopied] = useState<'code' | 'url' | null>(null);

  const [scope, setScope] = useExportScope();
  const scoped = useScopedDoc(doc, scope);
  const generator = CODE_EXPORTS[target];
  const text = useMemo(() => generator.render(scoped.doc, scoped), [generator, scoped]);

  const hints: Record<CodeTarget, string> = {
    pydantic: 'Pydantic v2 classes for the API models, e.g. FastAPI request and response bodies.',
    sqlalchemy: `SQLAlchemy 2.0 ORM classes for the ${DIALECTS[doc.database.dialect].label} tables; change the database in DB Schema.`,
    zod: 'Zod 4 schemas with inferred TypeScript types for the API models, to validate bodies in TypeScript.',
    sqlmodel: `SQLModel classes for the ${DIALECTS[doc.database.dialect].label} tables: each is both the table and its Pydantic model.`,
    drizzle: `Drizzle ORM schema for the ${DIALECTS[doc.database.dialect].label} tables, with relations for the query API.`,
    prisma: `Prisma 7 schema for the ${DIALECTS[doc.database.dialect].label} tables; for Prisma 6 add a url to the datasource.`,
    fastapi: 'A runnable FastAPI app: a route stub per endpoint plus the API models. Run it with fastapi dev main.py.',
  };
  const featureName = scopeFeatureName(doc, scope);
  const source = SOURCES[generator.source];
  const empty = generator.source === 'models' ? scoped.doc.models.length === 0 : !scoped.doc.nodes.some((n) => n.type === source.nodeType);
  const emptyHint = featureName ? `${featureName} has no ${source.label}.` : source.empty;

  const query = new URLSearchParams(scopeParams(scope)).toString();
  const liveUrl = projectId ? `${window.location.origin}/api/projects/${projectId}/code/${target}${query ? `?${query}` : ''}` : '';
  // Still an importable module name: `models_wishlist.py`, `schemas_wishlist.ts`
  const fileName = featureName
    ? generator.fileName.replace(/\.(\w+)$/, `_${featureName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}.$1`)
    : generator.fileName;

  const copy = async (what: 'code' | 'url', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Modal
      title="Code"
      description="Generated live from the canvas models, tables and endpoints"
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
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Target" className="inline-flex rounded-md border border-border bg-surface p-0.5">
            {CODE_TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={target === t}
                onClick={() => setTarget(t)}
                className={`rounded px-3 py-1 text-xs ${target === t ? 'bg-accent/20 text-accent' : 'text-text-muted'}`}
              >
                {CODE_EXPORTS[t].label}
              </button>
            ))}
          </div>
          <ScopePicker scope={scope} onChange={setScope} />
          <span className="flex-1 truncate text-xs text-text-muted" title={hints[target]}>
            {hints[target]}
          </span>
          <Button className="px-2 py-1 text-xs" onClick={() => copy('code', text)}>
            {copied === 'code' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy
          </Button>
          <Button className="px-2 py-1 text-xs" onClick={() => downloadText(text, fileName, generator.mimeType)}>
            <Download className="size-3.5" /> Download
          </Button>
          <Button className="px-2 py-1 text-xs" disabled={!liveUrl} onClick={() => copy('url', liveUrl)} title={liveUrl}>
            {copied === 'url' ? <Check className="size-3.5" /> : <Link className="size-3.5" />} Copy live URL
          </Button>
        </div>

        {empty && <p className="text-xs text-text-muted">{emptyHint}</p>}

        <div className="min-h-0 flex-1">
          <CodeView value={text} language={generator.language === 'prisma' ? 'text' : generator.language} label={`Code (${generator.label})`} />
        </div>
      </div>
    </Modal>
  );
}
