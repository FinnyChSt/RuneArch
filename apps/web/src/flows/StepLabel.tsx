import type { CanvasDoc } from '@flowcanvas/shared';
import { edgeCaption } from '../canvas/edgeText';
import { nodeTitle, sourceTitle } from '../canvas/flowView';

/** "Cart → POST /orders · calls" (or "Cart · Place order → …" from a button) for a flow step */
export function StepLabel({ doc, edgeId }: { doc: CanvasDoc; edgeId: string }) {
  const edge = doc.edges.find((e) => e.id === edgeId);
  if (!edge) return <span className="text-danger">Missing edge</span>;
  const node = (id: string) => doc.nodes.find((n) => n.id === id);
  return (
    <span className="min-w-0">
      <span className="truncate">
        {sourceTitle(node(edge.source), edge.sourceHandle)} → {nodeTitle(node(edge.target))}
      </span>
      <span className="text-text-muted"> · {edgeCaption(edge)}</span>
    </span>
  );
}
