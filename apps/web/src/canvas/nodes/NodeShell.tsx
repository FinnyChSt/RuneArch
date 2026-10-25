import { Handle, Position } from '@xyflow/react';
import type { CSSProperties, ReactNode } from 'react';
import type { NodeGroup } from '../mapping';

const GROUP_BAR: Record<NodeGroup, string> = {
  fe: 'bg-node-fe',
  be: 'bg-node-be',
  db: 'bg-node-db',
  sketch: 'bg-node-sketch',
};

type Props = {
  group: NodeGroup;
  selected: boolean;
  className?: string;
  /** Pins the left/right handles at this offset (px) instead of the vertical middle */
  sideHandleTop?: number;
  children: ReactNode;
};

/**
 * Card frame shared by all node types: group color bar, selection ring, and handles. Top is a target,
 * bottom a source; left and right are both, so a reverse edge can leave from the side facing its target.
 * Sources render last to sit on top: a drag always starts an edge from the handle it starts on.
 */
export function NodeShell({ group, selected, className = '', sideHandleTop, children }: Props) {
  const sideStyle = sideHandleTop === undefined ? undefined : { top: sideHandleTop };
  return (
    <div
      className={`relative min-w-44 rounded-lg border bg-surface text-text text-sm ${
        selected ? 'border-accent ring-2 ring-accent/40' : 'border-border'
      } ${className}`}
    >
      {/* No overflow clipping: column handles in table rows must stay whole */}
      <div className={`h-1 rounded-t-[7px] ${GROUP_BAR[group]}`} />
      {children}
      <NodeHandles sideStyle={sideStyle} />
    </div>
  );
}

/** The four-sided handle set of every connectable node (cards, sketch shapes) */
export function NodeHandles({ sideStyle }: { sideStyle?: CSSProperties }) {
  return (
    <>
      {/* Order matters: edges without a stored handle use the first of each type (t and r) */}
      <Handle id="t" type="target" position={Position.Top} />
      <Handle id="l" type="target" position={Position.Left} style={sideStyle} />
      <Handle id="r" type="target" position={Position.Right} style={sideStyle} />
      <Handle id="r" type="source" position={Position.Right} style={sideStyle} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} style={sideStyle} />
    </>
  );
}
