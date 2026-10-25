import { useReactFlow } from '@xyflow/react';
import { useEffect, type RefObject } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

const MARGIN = 48;
const DEFAULT_SIZE = { width: 200, height: 80 };

/** While stepping through a flow, pans (without zooming) when the current step is off-screen */
export function useFollowPlayhead(container: RefObject<HTMLElement | null>) {
  const { getViewport, setCenter } = useReactFlow();
  const playhead = useUiStore((s) => s.playhead);
  const flowId = useUiStore((s) => s.activeFlowId);

  useEffect(() => {
    const rect = container.current?.getBoundingClientRect();
    if (playhead === null || !flowId || !rect) return;
    const { doc, measured } = useCanvasStore.getState();
    const edgeId = doc.flows.find((f) => f.id === flowId)?.steps[playhead]?.edgeId;
    const edge = doc.edges.find((e) => e.id === edgeId);
    const ends = doc.nodes.filter((n) => n.id === edge?.source || n.id === edge?.target);
    if (ends.length === 0) return;

    const boxes = ends.map((n) => ({ ...n.position, ...(measured[n.id] ?? DEFAULT_SIZE) }));
    const x1 = Math.min(...boxes.map((b) => b.x));
    const y1 = Math.min(...boxes.map((b) => b.y));
    const x2 = Math.max(...boxes.map((b) => b.x + b.width));
    const y2 = Math.max(...boxes.map((b) => b.y + b.height));

    const { x, y, zoom } = getViewport();
    const visible =
      x1 * zoom + x >= MARGIN &&
      y1 * zoom + y >= MARGIN &&
      x2 * zoom + x <= rect.width - MARGIN &&
      y2 * zoom + y <= rect.height - MARGIN;
    if (!visible) void setCenter((x1 + x2) / 2, (y1 + y2) / 2, { zoom, duration: 300 });
  }, [playhead, flowId, container, getViewport, setCenter]);
}
