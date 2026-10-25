import type { EdgeKind } from '@flowcanvas/shared';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, type EdgeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { FlowEdge } from '../mapping';
import { crudText } from '../edgeText';
import { edgeStroke, StepBadge } from './flowStyle';

const DASH: Partial<Record<EdgeKind, string>> = {
  navigates: '6 4',
  emits: '1.5 4',
};

/** Kinds whose name is shown when the edge has no label of its own */
const SHOW_KIND: EdgeKind[] = ['reads', 'writes', 'emits'];

/** Gap (px) from the shared handle to each edge of a two-way pair */
const PAIR_OFFSET = 10;

/** Moves an end along its node's side; left/right handles shift vertically, top/bottom horizontally */
const shift = (x: number, y: number, side: Position, by: number) =>
  side === Position.Left || side === Position.Right ? { x, y: y + by } : { x: x + by, y };

export function LinkEdge({ data, selected, markerEnd, ...props }: EdgeProps<FlowEdge>) {
  // Both edges of a pair share their handles; opposite signs in canvas space draw them side by side
  const by = (data?.pair ?? 0) * PAIR_OFFSET;
  const source = shift(props.sourceX, props.sourceY, props.sourcePosition, by);
  const target = shift(props.targetX, props.targetY, props.targetPosition, by);
  const [path, labelX, labelY] = getBezierPath({
    ...props,
    sourceX: source.x,
    sourceY: source.y,
    targetX: target.x,
    targetY: target.y,
  });
  const edge = data?.edge;
  const kind = edge?.kind ?? 'calls';
  const crud = edge?.kind === 'fk' ? undefined : edge?.crud;
  const label = edge?.label ?? (crud?.length ? crudText(crud) : SHOW_KIND.includes(kind) ? kind : undefined);

  const flow = data?.flow;
  const style: CSSProperties = {
    ...edgeStroke(flow, selected),
    strokeDasharray: DASH[kind],
    strokeLinecap: 'round',
  };

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} className={flow?.current ? 'fc-edge-current' : undefined} />
      <StepBadge flow={flow} x={labelX} y={labelY} />
      {label && !flow?.step && (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-auto absolute rounded border border-border bg-surface px-1.5 font-mono text-[10px] text-text-muted ${
              flow?.dimmed ? 'opacity-20' : ''
            }`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
