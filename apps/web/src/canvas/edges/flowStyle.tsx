import { EdgeLabelRenderer } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { EdgeFlowState } from '../mapping';

/** Stroke for an edge: flow color for steps of the active flow (and edges a highlighted feature adds or changes), accent when selected */
export function edgeStroke(flow: EdgeFlowState | undefined, selected: boolean | undefined): CSSProperties {
  if (flow?.step) return { stroke: flow.color, strokeWidth: flow.current ? 3 : 2 };
  if (flow?.accent) return { stroke: flow.color, strokeWidth: selected ? 2.5 : 2 };
  return { stroke: selected ? 'var(--accent)' : 'var(--edge)', strokeWidth: selected ? 2 : 1.5 };
}

/** Numbered step badge at the edge's label position */
export function StepBadge({ flow, x, y }: { flow: EdgeFlowState | undefined; x: number; y: number }) {
  if (!flow?.step) return null;
  return (
    <EdgeLabelRenderer>
      <div
        aria-label={`Step ${flow.step}`}
        className={`nodrag nopan absolute flex size-5 items-center justify-center rounded-full font-mono text-[10px] font-semibold text-canvas ${
          flow.current ? 'fc-step-current' : ''
        }`}
        style={{ background: flow.color, transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
      >
        {flow.step}
      </div>
    </EdgeLabelRenderer>
  );
}
