import { CANVAS_EXPORTS, featureById, type CanvasExportFormat, type CanvasSvgTheme } from '@flowcanvas/shared';
import { Check, Copy, Download, ImageDown, Link } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button, compactControlClass } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { CodeView } from './CodeView';
import { downloadSvgAsPng, downloadText } from './download';
import { ScopePicker, scopeParams, useExportScope, useScopedDoc } from './ScopePicker';

const FORMATS = Object.keys(CANVAS_EXPORTS) as CanvasExportFormat[];

const HINTS: Record<CanvasExportFormat, string> = {
  svg: 'The canvas as an image for docs, tickets and slides; also as PNG.',
  mermaid: 'A flowchart that renders in GitHub/GitLab markdown inside a ```mermaid block.',
  json: 'The whole document as a RuneArch file, for backups and moving between projects.',
};

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Export the whole canvas: SVG/PNG image (light or dark, optionally one flow), Mermaid flowchart, JSON */
export default function ExportDialog({ onClose }: { onClose(): void }) {
  const doc = useCanvasStore((s) => s.doc);
  const measured = useCanvasStore((s) => s.measured);
  const projectId = useCanvasStore((s) => s.projectId);
  const saveState = useCanvasStore((s) => s.saveState);
  const [format, setFormat] = useState<CanvasExportFormat>('svg');
  const [theme, setTheme] = useState<CanvasSvgTheme>('light');
  const [flowId, setFlowId] = useState('');
  const [copied, setCopied] = useState<'text' | 'url' | null>(null);
  const [scope, setScope] = useExportScope();
  const scoped = useScopedDoc(doc, scope);
  const scopedFeature = scoped.featureId ? featureById(doc, scoped.featureId) : undefined;
  const feature = useMemo(
    () => (scopedFeature && scoped.roles ? { name: scopedFeature.name, color: scopedFeature.color, roles: scoped.roles } : undefined),
    [scopedFeature, scoped.roles],
  );

  const exporter = CANVAS_EXPORTS[format];
  const activeFlowId = exporter.flowAware && flowId ? flowId : undefined;
  // Boxes as big as on the canvas: stored sizes (frames, sketches) or what React Flow measured
  const sizes = useMemo(() => {
    const { sizeOf } = useCanvasStore.getState();
    return Object.fromEntries(doc.nodes.flatMap((n) => (n.size || measured[n.id] ? [[n.id, sizeOf(n)]] : [])));
  }, [doc, measured]);
  const text = useMemo(
    () => exporter.render(scoped.doc, { theme, flowId: activeFlowId, sizes, feature }),
    [exporter, scoped.doc, theme, activeFlowId, sizes, feature],
  );
  // A data URL: nothing to revoke, and the <img> keeps any script in the SVG inert
  const previewUrl = format === 'svg' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}` : null;

  const flow = doc.flows.find((f) => f.id === activeFlowId);
  const fileBase = [
    'canvas',
    ...(scopedFeature ? [slug(scopedFeature.name) || 'feature'] : []),
    ...(flow ? [slug(flow.name) || 'flow'] : []),
  ].join('-');
  const query = new URLSearchParams({
    ...(format === 'svg' && theme !== 'light' && { theme }),
    ...(activeFlowId && { flow: activeFlowId }),
    ...scopeParams(scope),
  }).toString();
  const liveUrl = projectId
    ? `${window.location.origin}/api/projects/${projectId}/canvas.${exporter.extension}${query ? `?${query}` : ''}`
    : '';

  const copy = async (what: 'text' | 'url', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Modal
      title="Export canvas"
      description="Generated live from the canvas"
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
                {CANVAS_EXPORTS[f].label}
              </button>
            ))}
          </div>
          {format === 'svg' && (
            <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-border bg-surface p-0.5">
              {(['light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={theme === t}
                  onClick={() => setTheme(t)}
                  className={`rounded px-3 py-1 text-xs capitalize ${theme === t ? 'bg-accent/20 text-accent' : 'text-text-muted'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <ScopePicker scope={scope} onChange={setScope} />
          {exporter.flowAware && scoped.doc.flows.length > 0 && (
            <select
              aria-label="Highlight flow"
              value={flowId}
              onChange={(e) => setFlowId(e.target.value)}
              className={`${compactControlClass} w-48`}
            >
              <option value="">Whole canvas</option>
              {scoped.doc.flows.map((f) => (
                <option key={f.id} value={f.id}>
                  Flow: {f.name}
                </option>
              ))}
            </select>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{HINTS[format]}</span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {format !== 'svg' && (
            <Button className="px-2 py-1 text-xs" onClick={() => copy('text', text)}>
              {copied === 'text' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy
            </Button>
          )}
          <Button
            className="px-2 py-1 text-xs"
            onClick={() => downloadText(text, `${fileBase}.${exporter.extension}`, exporter.mimeType)}
          >
            <Download className="size-3.5" /> Download {exporter.extension.toUpperCase()}
          </Button>
          {format === 'svg' && (
            <Button className="px-2 py-1 text-xs" onClick={() => void downloadSvgAsPng(text, `${fileBase}.png`)}>
              <ImageDown className="size-3.5" /> Download PNG
            </Button>
          )}
          <Button className="px-2 py-1 text-xs" disabled={!liveUrl} onClick={() => copy('url', liveUrl)} title={liveUrl}>
            {copied === 'url' ? <Check className="size-3.5" /> : <Link className="size-3.5" />} Copy live URL
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          {previewUrl ? (
            <div className="size-full overflow-auto rounded-lg border border-border bg-canvas p-3">
              <img src={previewUrl} alt="Canvas preview" className="mx-auto max-w-full" />
            </div>
          ) : (
            <CodeView value={text} language={format === 'json' ? 'json' : 'text'} label={`Canvas (${exporter.label})`} />
          )}
        </div>
      </div>
    </Modal>
  );
}
