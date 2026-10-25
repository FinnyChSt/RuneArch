import { useMemo } from 'react';
import { featureView } from '../canvas/featureView';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

/** The highlighted feature: the one picked in the panel, else the one being worked on; a highlighted flow wins */
export function useFeatureView() {
  const doc = useCanvasStore((s) => s.doc);
  const activeFeatureId = useCanvasStore((s) => s.activeFeatureId);
  const viewFeatureId = useUiStore((s) => s.viewFeatureId);
  const activeFlowId = useUiStore((s) => s.activeFlowId);
  return useMemo(
    () => (activeFlowId ? null : featureView(doc, viewFeatureId ?? activeFeatureId)),
    [doc, activeFlowId, viewFeatureId, activeFeatureId],
  );
}
