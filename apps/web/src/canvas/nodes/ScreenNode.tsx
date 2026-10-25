import { isInteractive, WIRE_ROW_PX, wireframeRows, type WireDevice, type Wireframe } from '@flowcanvas/shared';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { elementSideHandleId } from '../handles';
import type { ElementFlowMarks, FlowNode } from '../mapping';
import { cellStyle, gridOf, WireframeView } from '../wireframe/WireframeView';
import { NodeShell } from './NodeShell';

/** Thumbnail width per device on the canvas (px at zoom 1) */
const THUMB_WIDTH: Record<WireDevice, number> = { desktop: 280, tablet: 220, mobile: 150 };
/** Below this zoom, thumbnail text turns into grey bars (same size, so edges don't move) */
const SKELETON_ZOOM = 0.6;

export function ScreenNode({ data: { node, flowMarks, elementMarks }, selected }: NodeProps<FlowNode<'screen'>>) {
  const { wireframe } = node.data;
  const skeleton = useStore((s) => s.transform[2] < SKELETON_ZOOM);
  return (
    <NodeShell group="fe" selected={selected}>
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-raised px-2.5 py-1.5">
        <span className="size-1.5 rounded-full bg-text-muted/50" />
        <span className="size-1.5 rounded-full bg-text-muted/50" />
        <span className="size-1.5 rounded-full bg-text-muted/50" />
        <span className="ml-1.5 truncate font-mono text-xs text-text-muted">{node.data.route ?? '/'}</span>
      </div>
      <div className="px-3 py-3 font-medium">{node.label || 'Untitled screen'}</div>
      {wireframe && wireframe.elements.length > 0 && (
        <div className="px-3 pb-3">
          <div className="relative">
            <WireframeView
              wireframe={wireframe}
              width={THUMB_WIDTH[wireframe.device]}
              maxHeight={THUMB_WIDTH[wireframe.device] * 1.5}
              skeleton={skeleton}
            />
            <ElementLayer wireframe={wireframe} marks={flowMarks} featureMarks={elementMarks} />
          </div>
        </div>
      )}
    </NodeShell>
  );
}

/**
 * Over the thumbnail, unscaled: a source handle on each side of every interactive element (so a
 * button can call an endpoint or open a screen), the active flow's step badges on elements, and
 * `+` / `~` on elements the highlighted feature adds or changes.
 */
function ElementLayer({
  wireframe,
  marks,
  featureMarks,
}: {
  wireframe: Wireframe;
  marks?: ElementFlowMarks;
  featureMarks?: Readonly<Record<string, 'added' | 'changed'>>;
}) {
  const width = THUMB_WIDTH[wireframe.device];
  const { designWidth, column } = gridOf(wireframe.device);
  const scale = width / designWidth;
  // Elements below the clipped part keep their handles at the bottom edge, so their edges still attach
  const visibleHeight = Math.min(width * 1.5, (wireframeRows(wireframe) + 2) * WIRE_ROW_PX * scale);

  return wireframe.elements.filter((el) => isInteractive(el.kind) || featureMarks?.[el.id]).map((el) => {
    const box = cellStyle(el.rect, column) as Record<'left' | 'top' | 'width' | 'height', number>;
    const top = Math.min(box.top * scale, visibleHeight - 4);
    const height = Math.max(0, Math.min(box.height * scale, visibleHeight - top));
    const step = marks?.steps[el.id];
    const feature = featureMarks?.[el.id];
    return (
      <div
        key={el.id}
        data-element={el.id}
        className="pointer-events-none absolute rounded-sm"
        style={{
          left: box.left * scale,
          top,
          width: box.width * scale,
          height,
          ...(step && { outline: `2px solid ${marks.color}`, outlineOffset: 1 }),
          ...(feature && !step && { outline: '1.5px dashed var(--feature-color, var(--accent))', outlineOffset: 1 }),
        }}
      >
        {feature && (
          <span
            aria-label={feature === 'added' ? 'Added by the feature' : 'Changed by the feature'}
            className="absolute -top-2 -right-2 flex size-3.5 items-center justify-center rounded-full font-mono text-[9px] font-semibold text-canvas"
            style={{ background: 'var(--feature-color, var(--accent))' }}
          >
            {feature === 'added' ? '+' : '~'}
          </span>
        )}
        {step && (
          <span
            aria-label={`Step ${step} starts here`}
            className={`absolute -top-2 -left-2 flex size-4 items-center justify-center rounded-full font-mono text-[9px] font-semibold text-canvas ${
              marks.current === el.id ? 'fc-step-current' : ''
            }`}
            style={{ background: marks.color }}
          >
            {step}
          </span>
        )}
        {isInteractive(el.kind) && (
          <>
            <Handle id={elementSideHandleId(el.id, 'l')} type="source" position={Position.Left} className="fc-el-handle" />
            <Handle id={elementSideHandleId(el.id, 'r')} type="source" position={Position.Right} className="fc-el-handle" />
          </>
        )}
      </div>
    );
  });
}
