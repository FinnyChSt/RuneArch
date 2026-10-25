import { featureById } from '@flowcanvas/shared';
import { flowColorVar } from '../canvas/flowColors';
import { Button } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';

/** Floating bar while edits are tagged in a feature */
export function FeatureBar() {
  const feature = useCanvasStore((s) => (s.activeFeatureId ? featureById(s.doc, s.activeFeatureId) : undefined));
  if (!feature) return null;

  return (
    <div
      role="status"
      className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-surface-raised py-1.5 pr-1.5 pl-3 text-sm shadow-lg"
    >
      <span className="size-2 rounded-full" style={{ background: flowColorVar(feature.color) }} />
      <span>
        Working on <span className="font-medium" style={{ color: flowColorVar(feature.color) }}>{feature.name}</span>
        <span className="text-text-muted"> · new and edited items are tagged in it</span>
      </span>
      <Button className="px-2 py-1 text-xs" onClick={() => useCanvasStore.getState().setActiveFeature(null)}>
        Stop
      </Button>
    </div>
  );
}
