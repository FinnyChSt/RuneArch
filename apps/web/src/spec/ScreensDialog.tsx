import { SCREEN_EXPORTS, type ScreenExportFormat } from '@flowcanvas/shared';
import { Check, Copy, Download, Link } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { CodeView } from './CodeView';
import { downloadText } from './download';

const FORMATS = Object.keys(SCREEN_EXPORTS) as ScreenExportFormat[];

const HINTS: Record<ScreenExportFormat, string> = {
  markdown: 'Paste into a ticket or hand to an AI to build the screens.',
  json: 'The same description, structured for scripts and tools.',
};

/** Live description of every screen: layout, what each element does, called endpoints and used models */
export default function ScreensDialog({ onClose }: { onClose(): void }) {
  const doc = useCanvasStore((s) => s.doc);
  const projectId = useCanvasStore((s) => s.projectId);
  const saveState = useCanvasStore((s) => s.saveState);
  const [format, setFormat] = useState<ScreenExportFormat>('markdown');
  const [copied, setCopied] = useState<'text' | 'url' | null>(null);

  const exporter = SCREEN_EXPORTS[format];
  const text = useMemo(() => exporter.render(doc), [exporter, doc]);
  const hasScreens = doc.nodes.some((n) => n.type === 'screen');
  const liveUrl = projectId ? `${window.location.origin}/api/projects/${projectId}/screens.${exporter.extension}` : '';

  const copy = async (what: 'text' | 'url', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Modal
      title="Screens"
      description="Generated live from the screens, their wireframes and what they connect to"
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
                {SCREEN_EXPORTS[f].label}
              </button>
            ))}
          </div>
          <span className="flex-1 truncate text-xs text-text-muted">{HINTS[format]}</span>
          <Button className="px-2 py-1 text-xs" onClick={() => copy('text', text)}>
            {copied === 'text' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Copy
          </Button>
          <Button
            className="px-2 py-1 text-xs"
            onClick={() => downloadText(text, `screens.${exporter.extension}`, exporter.mimeType)}
          >
            <Download className="size-3.5" /> Download
          </Button>
          <Button className="px-2 py-1 text-xs" disabled={!liveUrl} onClick={() => copy('url', liveUrl)} title={liveUrl}>
            {copied === 'url' ? <Check className="size-3.5" /> : <Link className="size-3.5" />} Copy live URL
          </Button>
        </div>

        {!hasScreens && <p className="text-xs text-text-muted">No screens on the canvas yet; add one with the screen tool (S).</p>}

        <div className="min-h-0 flex-1">
          <CodeView value={text} language={format === 'json' ? 'json' : 'text'} label={`Screens (${exporter.label})`} />
        </div>
      </div>
    </Modal>
  );
}
