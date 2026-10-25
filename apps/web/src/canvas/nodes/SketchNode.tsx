import { NodeResizer, type NodeProps } from '@xyflow/react';
import { getStroke } from 'perfect-freehand';
import { useMemo, useRef, type KeyboardEvent } from 'react';
import { useCanvasStore } from '../../store/canvasStore';
import { useUiStore } from '../../store/uiStore';
import type { FlowNode } from '../mapping';
import { NodeHandles } from './NodeShell';

type Sketch = FlowNode<'sketch'>['data']['node'];

/** Pen stroke options (flow px); the same in the live preview and on the canvas */
export const STROKE_OPTIONS = { size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5 };

/** perfect-freehand outline -> SVG path */
export function strokePath(points: readonly (readonly number[])[], last = true): string {
  const outline = getStroke(points as number[][], { ...STROKE_OPTIONS, last });
  if (outline.length < 2) return '';
  const [first, ...rest] = outline;
  return `M${first![0]},${first![1]} ${rest.map(([x, y]) => `L${x},${y}`).join(' ')} Z`;
}

const SHAPE_CLASS: Record<Exclude<Sketch['data']['shape'], 'freehand'>, string> = {
  rect: 'rounded-md border-2 border-node-sketch text-text',
  ellipse: 'rounded-[50%] border-2 border-node-sketch text-text',
  text: 'text-text text-base',
  sticky: 'bg-node-sketch text-canvas shadow-lg shadow-black/30 rounded-sm',
};

/**
 * Sketch shapes: rectangle, ellipse, free text, sticky note and pen strokes. Double-click edits the
 * text in place (one undo step on blur); shapes resize when selected; arrows attach to any side.
 */
export function SketchNode({ data: { node }, selected }: NodeProps<FlowNode<'sketch'>>) {
  const { shape } = node.data;
  const editing = useUiStore((s) => s.editingId === node.id);

  if (shape === 'freehand') return <Stroke node={node} selected={selected} />;
  return (
    <>
      <NodeResizer isVisible={selected && !editing} minWidth={40} minHeight={24} color="var(--accent)" />
      <div
        className={`flex size-full overflow-hidden p-2 text-sm leading-snug ${SHAPE_CLASS[shape]} ${
          shape === 'text' ? 'items-start' : 'items-center justify-center text-center'
        } ${selected && shape === 'text' ? 'outline-1 outline-accent/50 outline-dashed' : ''}`}
      >
        {editing ? (
          <TextEditor node={node} />
        ) : (
          <span className="whitespace-pre-wrap break-words">{node.data.text}</span>
        )}
      </div>
      <NodeHandles />
    </>
  );
}

/** In-place text editing; commits once when it loses focus (Esc or ⌘Enter also finish) */
function TextEditor({ node }: { node: Sketch }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const finish = () => {
    const text = ref.current?.value ?? '';
    useUiStore.getState().setEditing(null);
    if (text !== (node.data.text ?? '')) useCanvasStore.getState().updateNode(node.id, { data: { ...node.data, text: text || undefined } });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) ref.current?.blur();
  };
  return (
    <textarea
      ref={ref}
      aria-label="Text"
      autoFocus
      defaultValue={node.data.text ?? ''}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={finish}
      onKeyDown={onKeyDown}
      className={`nodrag nopan nowheel size-full resize-none bg-transparent outline-none ${
        node.data.shape === 'text' ? 'text-left' : 'text-center'
      }`}
    />
  );
}

function Stroke({ node, selected }: { node: Sketch; selected: boolean }) {
  const d = useMemo(() => strokePath(node.data.points ?? []), [node.data.points]);
  return (
    <>
      <svg className={`size-full overflow-visible ${selected ? 'rounded-sm outline-1 outline-accent/60 outline-dashed' : ''}`}>
        <path d={d} className="fill-node-sketch" />
      </svg>
      <NodeHandles />
    </>
  );
}
