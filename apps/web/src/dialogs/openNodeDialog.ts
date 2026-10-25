import type { NodeType } from '@flowcanvas/shared';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore, type Dialog } from '../store/uiStore';

/** Node types that have an edit dialog */
const DIALOG_KIND: Partial<Record<NodeType, Dialog['kind']>> = {
  screen: 'screen',
  component: 'component',
  frame: 'frame',
  service: 'service',
  job: 'job',
  endpoint: 'endpoint',
  table: 'table',
};

/** Opens the edit dialog for a node, if its type has one (sketches: in-place text editing). Returns whether it did. */
export function openNodeDialog(nodeId: string): boolean {
  const node = useCanvasStore.getState().doc.nodes.find((n) => n.id === nodeId);
  // Sketch shapes edit their text in place (pen strokes have none)
  if (node?.type === 'sketch') {
    if (node.data.shape === 'freehand') return false;
    useUiStore.getState().setEditing(nodeId);
    return true;
  }
  const kind = node && DIALOG_KIND[node.type];
  if (!kind) return false;
  useUiStore.getState().openDialog({ kind, id: nodeId });
  return true;
}
