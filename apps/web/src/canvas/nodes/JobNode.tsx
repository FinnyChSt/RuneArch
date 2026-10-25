import type { NodeProps } from '@xyflow/react';
import { Clock, ListOrdered, Zap } from 'lucide-react';
import type { FlowNode } from '../mapping';
import { NodeShell } from './NodeShell';

const TRIGGER = {
  event: { icon: Zap, label: 'Event' },
  queue: { icon: ListOrdered, label: 'Queue job' },
  cron: { icon: Clock, label: 'Scheduled job' },
};

/** Background job or event (edited in JobDialog) */
export function JobNode({ data: { node }, selected }: NodeProps<FlowNode<'job'>>) {
  const { icon: Icon, label } = TRIGGER[node.data.trigger];
  return (
    <NodeShell group="be" selected={selected}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Icon className="size-4 shrink-0 text-node-be" />
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-medium">{node.label || 'untitled'}</div>
          <div className="text-xs text-text-muted">
            {label}
            {node.data.schedule && <span className="font-mono"> · {node.data.schedule}</span>}
          </div>
        </div>
      </div>
    </NodeShell>
  );
}
