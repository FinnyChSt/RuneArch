import type { NodeProps } from '@xyflow/react';
import { Cog } from 'lucide-react';
import type { FlowNode } from '../mapping';
import { NodeShell } from './NodeShell';

export function ServiceNode({ data: { node }, selected }: NodeProps<FlowNode<'service'>>) {
  const count = node.data.methods.length;
  return (
    <NodeShell group="be" selected={selected}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Cog className="size-4 shrink-0 text-node-be" />
        <div className="min-w-0">
          <div className="truncate font-medium">{node.label || 'Untitled service'}</div>
          <div className="text-xs text-text-muted">
            {count === 0 ? 'Service' : `${count} method${count === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>
    </NodeShell>
  );
}
