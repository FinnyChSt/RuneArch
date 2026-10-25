import { DEVICES, WireDevice, wireComponentsOf, wireframeToSvg, type WireComponents, type Wireframe } from '@flowcanvas/shared';
import { Download, Redo2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { inferEdgeKind } from '../../canvas/connectRules';
import { nodeTitle } from '../../canvas/flowView';
import type { NodeOf } from '../../canvas/mapping';
import { WireframeView } from '../../canvas/wireframe/WireframeView';
import { Button, IconAction } from '../../components/ui/form';
import { useCanvasStore } from '../../store/canvasStore';
import { downloadSvgAsPng, downloadText } from '../../spec/download';
import type { ScreenDesign } from '../drafts';
import { collectionFromEndpoint, endpointSources, formFromEndpoint } from './fromApi';
import { FromEndpoint, type GenerateKind } from './FromEndpoint';
import { WIRE_TEMPLATES, wireframeFromTemplate } from './templates';
import type { Undoable } from './useUndo';
import { WireframeEditor, type LinkTarget } from './WireframeEditor';
import { tidyWireframe } from './wireframeDraft';

type Props = {
  /** A screen, or a component (whose layout can't link elements or place other components) */
  node: NodeOf<'screen'> | NodeOf<'component'>;
  /** Wireframe and element links from the dialog draft */
  design: ScreenDesign;
  /** Changes go through the draft's undo history */
  history: Undoable<ScreenDesign>;
  error?: string;
};

const CARD_WIDTH = 168;

/** Screens and endpoints an element can link to, with the kind the link gets (screens only) */
function useLinkTargets(screen: NodeOf<'screen'> | NodeOf<'component'>): LinkTarget[] {
  const nodes = useCanvasStore((s) => s.doc.nodes);
  return useMemo(
    () =>
      nodes.flatMap((n) => {
        if (screen.type !== 'screen' || n.id === screen.id || (n.type !== 'screen' && n.type !== 'endpoint')) return [];
        const result = inferEdgeKind(screen, n);
        return result.ok ? [{ id: n.id, title: nodeTitle(n), group: n.type, kind: result.kind }] : [];
      }),
    [nodes, screen],
  );
}

/** Endpoints on the canvas, to generate forms and lists from */
function useEndpoints() {
  const nodes = useCanvasStore((s) => s.doc.nodes);
  return useMemo(() => nodes.filter((n): n is NodeOf<'endpoint'> => n.type === 'endpoint'), [nodes]);
}

/** Components by id (for rendering instances) and as a list (for placing them) */
function useComponents() {
  const nodes = useCanvasStore((s) => s.doc.nodes);
  return useMemo(() => {
    const byId = wireComponentsOf({ nodes });
    return { byId, list: [...byId].map(([id, c]) => ({ id, ...c })) };
  }, [nodes]);
}

/** Downloads the draft wireframe as SVG or PNG, titled and named after the screen */
function exportWireframe(wireframe: Wireframe, name: string, format: 'svg' | 'png', components: WireComponents) {
  const svg = wireframeToSvg(tidyWireframe(wireframe), { title: name || undefined, components });
  const file = `${name.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'screen'}-wireframe`;
  if (format === 'svg') downloadText(svg, `${file}.svg`, 'image/svg+xml');
  else void downloadSvgAsPng(svg, `${file}.png`);
}

/** Wireframe tab of the Screen and Component dialogs: start from a template, then edit in the wireframe editor */
export function WireframeTab({ node, design, history, error }: Props) {
  const isScreen = node.type === 'screen';
  const { wireframe: value, links } = design;
  const [choosing, setChoosing] = useState(value === null);
  const [device, setDevice] = useState<WireDevice>(value?.device ?? 'desktop');
  const targets = useLinkTargets(node);
  const components = useComponents();
  const endpoints = useEndpoints();
  const models = useCanvasStore((s) => s.doc.models);
  const [generating, setGenerating] = useState(false);
  const setWireframe = (wireframe: Wireframe | null, key?: string) => history.change({ ...design, wireframe }, key);

  const changeDevice = (next: WireDevice) => {
    setDevice(next);
    if (value) setWireframe({ ...value, device: next });
  };

  /** Adds a form, list or table (and the submit button's link) in one undo step */
  const generate = (kind: GenerateKind, endpoint: NodeOf<'endpoint'>) => {
    if (!value) return;
    const { request, response } = endpointSources(endpoint, models);
    const result =
      kind === 'form'
        ? request.model && formFromEndpoint(value, endpoint, request.model)
        : response.model && collectionFromEndpoint(value, response.model, kind);
    if (!result) return;
    history.change({ wireframe: result.wireframe, links: isScreen ? [...links, ...result.links] : links });
    setGenerating(false);
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <DevicePicker value={device} onChange={changeDevice} />
        <div className="flex">
          <IconAction label="Undo wireframe change" disabled={!history.canUndo} onClick={history.undo}>
            <Undo2 className="size-3.5" />
          </IconAction>
          <IconAction label="Redo wireframe change" disabled={!history.canRedo} onClick={history.redo}>
            <Redo2 className="size-3.5" />
          </IconAction>
        </div>
        {value && !choosing && (
          <div className="ml-auto flex gap-2">
            <Button aria-expanded={generating} onClick={() => setGenerating((g) => !g)}>
              From endpoint
            </Button>
            {(['svg', 'png'] as const).map((format) => (
              <Button
                key={format}
                variant="ghost"
                title={`Download as ${format.toUpperCase()}`}
                onClick={() => exportWireframe(value, node.label, format, components.byId)}
              >
                <Download className="size-3.5" /> {format.toUpperCase()}
              </Button>
            ))}
            <Button onClick={() => setChoosing(true)}>Change template</Button>
            <Button variant="ghost" onClick={() => setWireframe(null)}>
              Remove wireframe
            </Button>
          </div>
        )}
      </div>

      {value && !choosing && generating && (
        <FromEndpoint endpoints={endpoints} models={models} onGenerate={generate} onClose={() => setGenerating(false)} />
      )}

      {value && !choosing ? (
        <WireframeEditor
          wireframe={value}
          links={links}
          targets={targets}
          models={models}
          components={isScreen ? components.list : undefined}
          linkable={isScreen}
          onChange={setWireframe}
          onLinksChange={(next) => history.change({ ...design, links: next })}
          onUndo={history.undo}
          onRedo={history.redo}
        />
      ) : (
        <TemplateGallery
          device={device}
          onPick={(wireframe) => {
            setWireframe(wireframe);
            setChoosing(false);
          }}
          onCancel={value ? () => setChoosing(false) : undefined}
        />
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function DevicePicker({ value, onChange }: { value: WireDevice; onChange(device: WireDevice): void }) {
  return (
    <div role="radiogroup" aria-label="Device" className="flex rounded-md border border-border p-0.5">
      {WireDevice.options.map((device) => (
        <button
          key={device}
          type="button"
          role="radio"
          aria-checked={device === value}
          onClick={() => onChange(device)}
          className={`rounded px-2.5 py-1 text-xs ${
            device === value ? 'bg-surface text-text' : 'text-text-muted hover:text-text'
          }`}
        >
          {DEVICES[device].label}
        </button>
      ))}
    </div>
  );
}

function TemplateGallery({
  device,
  onPick,
  onCancel,
}: {
  device: WireDevice;
  onPick(wireframe: Wireframe): void;
  onCancel?(): void;
}) {
  // Previews only; picking builds a fresh copy with new element ids
  const previews = useMemo(() => WIRE_TEMPLATES.map((t) => ({ t, preview: wireframeFromTemplate(t, device) })), [device]);
  return (
    <div className="grid gap-3">
      <div className="flex items-baseline justify-between">
        <p className="text-text-muted">Start from a template:</p>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Keep current
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-3">
        {previews.map(({ t, preview }) => (
          <button
            key={t.id}
            type="button"
            aria-label={`${t.label} template`}
            onClick={() => onPick(wireframeFromTemplate(t, device))}
            className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-2 hover:border-accent focus-visible:border-accent"
          >
            {preview.elements.length > 0 ? (
              <WireframeView wireframe={preview} width={device === 'mobile' ? CARD_WIDTH * 0.6 : CARD_WIDTH} maxHeight={160} />
            ) : (
              <div className="flex h-24 w-full items-center justify-center rounded-md border-2 border-dashed border-wire-line bg-wire-paper text-xs text-text-muted">
                Empty page
              </div>
            )}
            <span className="text-xs font-medium">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
