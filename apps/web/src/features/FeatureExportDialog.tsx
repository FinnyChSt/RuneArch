import { DIALECTS, FEATURE_EXPORTS, SQL_DIALECTS, SqlDialect, type Feature, type FeatureExportFormat } from '@flowcanvas/shared';
import { Check, Copy, Download, Link } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button, compactControlClass } from '../components/ui/form';
import { CodeView } from '../spec/CodeView';
import { downloadText } from '../spec/download';
import { useCanvasStore } from '../store/canvasStore';

const FORMATS = Object.keys(FEATURE_EXPORTS) as FeatureExportFormat[];

const HINTS: Record<FeatureExportFormat, string> = {
  brief: 'What exists, what is new, changed or removed: hand it to a developer or an AI.',
  briefJson: 'The same brief as structured data.',
  tasks: 'A checklist per lane, ready for tickets.',
  migrationUp: 'Applies the feature’s database changes.',
  migrationDown: 'Undoes them.',
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'feature';

/** One feature's hand-off: brief, task list and migration, generated live */
export function FeatureExportDialog({ feature, onClose }: { feature: Feature; onClose(): void }) {
  const doc = useCanvasStore((s) => s.doc);
  const projectId = useCanvasStore((s) => s.projectId);
  const saveState = useCanvasStore((s) => s.saveState);
  const [format, setFormat] = useState<FeatureExportFormat>('brief');
  const saved = doc.database.dialect;
  const [dialect, setDialect] = useState<SqlDialect>(saved);
  const [copied, setCopied] = useState<'text' | 'url' | null>(null);

  const exporter = FEATURE_EXPORTS[format];
  const text = useMemo(() => exporter.render(doc, feature.id, { dialect }) ?? '', [exporter, doc, feature.id, dialect]);
  const query = exporter.dialectAware && dialect !== saved ? `?dialect=${dialect}` : '';
  const liveUrl = projectId
    ? `${window.location.origin}/api/projects/${projectId}/features/${encodeURIComponent(feature.id)}/${exporter.file}${query}`
    : '';
  const fileName = `${slug(feature.name)}-${exporter.file}`;

  const copy = async (what: 'text' | 'url', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Modal
      title={`Export ${feature.name}`}
      description="Generated live from the feature and the canvas"
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
        <div className="flex flex-wrap items-center gap-2">
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
                {FEATURE_EXPORTS[f].label}
              </button>
            ))}
          </div>
          {exporter.dialectAware && (
            <select
              aria-label="SQL dialect"
              value={dialect}
              onChange={(e) => setDialect(SqlDialect.parse(e.target.value))}
              className={`${compactControlClass} w-36`}
            >
              {SQL_DIALECTS.map((d) => (
                <option key={d} value={d}>
                  {DIALECTS[d].label}
                </option>
              ))}
            </select>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{HINTS[format]}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button className="px-2 py-1 text-xs" onClick={() => copy('text', text)}>
            {copied === 'text' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy
          </Button>
          <Button className="px-2 py-1 text-xs" onClick={() => downloadText(text, fileName, exporter.mimeType)}>
            <Download className="size-3.5" /> Download
          </Button>
          <Button className="px-2 py-1 text-xs" disabled={!liveUrl} onClick={() => copy('url', liveUrl)} title={liveUrl}>
            {copied === 'url' ? <Check className="size-3.5" /> : <Link className="size-3.5" />} Copy live URL
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <CodeView value={text} language={format === 'briefJson' ? 'json' : 'text'} label={`${feature.name} (${exporter.label})`} />
        </div>
      </div>
    </Modal>
  );
}
