import { typeLabel } from '@flowcanvas/shared';
import type { NodeProps } from '@xyflow/react';
import { Lock } from 'lucide-react';
import { MethodBadge } from '../../components/MethodBadge';
import { useCanvasStore } from '../../store/canvasStore';
import type { FlowNode } from '../mapping';
import { NodeShell } from './NodeShell';

export function EndpointNode({ data: { node }, selected }: NodeProps<FlowNode<'endpoint'>>) {
  const { method, path, auth, spec } = node.data;
  const models = useCanvasStore((s) => s.doc.models);
  const body = spec.requestBody && typeLabel(spec.requestBody.type, models);
  return (
    <NodeShell group="be" selected={selected}>
      <div className="flex items-center gap-2 px-2.5 pt-2.5">
        <MethodBadge method={method} />
        <span className="truncate font-mono text-xs">{path}</span>
        {auth !== 'public' && <Lock aria-label={`Auth: ${auth}`} className="ml-auto size-3 shrink-0 text-text-muted" />}
      </div>
      {(spec.summary || node.label) && (
        <div className="max-w-60 truncate px-2.5 pt-1 text-xs text-text-muted">{spec.summary || node.label}</div>
      )}
      {/* Brief: "CreateOrderDto → 201, 400" */}
      <div className="flex flex-wrap items-center gap-1 px-2.5 pt-2 pb-2.5">
        {body && <span className="max-w-32 truncate font-mono text-[10px] text-text-muted">{body} →</span>}
        {spec.responses.map((r) => (
          <span key={r.status} className="rounded border border-border px-1 font-mono text-[10px] text-text-muted">
            {r.status}
          </span>
        ))}
      </div>
    </NodeShell>
  );
}
