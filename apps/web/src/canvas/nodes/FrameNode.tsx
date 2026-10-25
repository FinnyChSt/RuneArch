import { NodeResizer, type NodeProps } from '@xyflow/react';
import type { FlowNode } from '../mapping';

/** Lane color: a frontend/backend/database swimlane takes its group color, a plain frame the sketch color */
const LANE_COLOR = {
  frontend: 'var(--node-fe)',
  backend: 'var(--node-be)',
  database: 'var(--node-db)',
  none: 'var(--node-sketch)',
} as const;

/** A swimlane or group: a titled, tinted area whose children move with it. Resizable when selected. */
export function FrameNode({ data: { node }, selected }: NodeProps<FlowNode<'frame'>>) {
  const color = LANE_COLOR[node.data.lane];
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} color="var(--accent)" />
      <div
        className="relative size-full rounded-xl border-2 border-dashed"
        style={{
          borderColor: `color-mix(in srgb, ${color} ${selected ? 90 : 45}%, transparent)`,
          background: `color-mix(in srgb, ${color} 6%, transparent)`,
        }}
      >
        <div
          className="absolute top-2 left-3 max-w-[calc(100%-24px)] truncate rounded-md px-2 py-0.5 text-sm font-medium"
          style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
        >
          {node.label || 'Frame'}
        </div>
      </div>
    </>
  );
}
