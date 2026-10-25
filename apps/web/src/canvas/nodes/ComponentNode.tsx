import type { WireDevice } from '@flowcanvas/shared';
import { useStore, type NodeProps } from '@xyflow/react';
import { Puzzle } from 'lucide-react';
import type { FlowNode } from '../mapping';
import { WireframeView } from '../wireframe/WireframeView';
import { NodeShell } from './NodeShell';

/** Thumbnail width per device (px at zoom 1); a bit narrower than a screen's */
const THUMB_WIDTH: Record<WireDevice, number> = { desktop: 220, tablet: 180, mobile: 130 };
const SKELETON_ZOOM = 0.6;

/** A reusable piece of UI: name, props and its wireframe, which screens place as instances */
export function ComponentNode({ data: { node }, selected }: NodeProps<FlowNode<'component'>>) {
  const { wireframe, props } = node.data;
  const skeleton = useStore((s) => s.transform[2] < SKELETON_ZOOM);
  return (
    <NodeShell group="fe" selected={selected}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Puzzle className="size-4 shrink-0 text-node-fe" />
        <div className="min-w-0">
          <div className="truncate font-medium">{node.label || 'Untitled component'}</div>
          <div className="truncate text-xs text-text-muted">
            {props.length === 0 ? 'Component' : props.join(', ')}
          </div>
        </div>
      </div>
      {wireframe && wireframe.elements.length > 0 && (
        <div className="px-3 pb-3">
          <WireframeView
            wireframe={wireframe}
            width={THUMB_WIDTH[wireframe.device]}
            maxHeight={THUMB_WIDTH[wireframe.device]}
            skeleton={skeleton}
          />
        </div>
      )}
    </NodeShell>
  );
}
