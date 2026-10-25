import { flowColorVar } from '../canvas/flowColors';
import { Button } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

/** Floating bar while a flow is being recorded */
export function RecordingBar() {
  const recording = useUiStore((s) => s.flowRecording);
  const flowId = useUiStore((s) => s.activeFlowId);
  const flow = useCanvasStore((s) => s.doc.flows.find((f) => f.id === flowId));
  if (!recording || !flow) return null;

  const removeLast = () => useCanvasStore.getState().saveFlow({ ...flow, steps: flow.steps.slice(0, -1) });

  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-surface-raised py-1.5 pr-1.5 pl-3 text-sm shadow-lg"
    >
      <span className="size-2 animate-pulse rounded-full bg-danger" />
      <span>
        Recording <span className="font-medium" style={{ color: flowColorVar(flow.color) }}>{flow.name}</span>
        <span className="text-text-muted">
          {' '}
          · {flow.steps.length} step{flow.steps.length === 1 ? '' : 's'} ·{' '}
          {flow.steps.length === 0 ? 'click the first edge' : 'click the next edge'}
        </span>
      </span>
      <Button className="px-2 py-1 text-xs" disabled={flow.steps.length === 0} onClick={removeLast}>
        Remove last step
      </Button>
      <Button variant="primary" className="px-2 py-1 text-xs" onClick={() => useUiStore.getState().stopRecording()}>
        Done
      </Button>
    </div>
  );
}
