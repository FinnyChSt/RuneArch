import type { Flow } from '@flowcanvas/shared';
import { Circle, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { flowColorVar, nextFlowColor } from '../canvas/flowColors';
import { Button, controlClass, IconAction } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { ColorSwatches } from './ColorSwatches';
import { StepLabel } from './StepLabel';

/** Right panel "Flows" tab: list, create (then record), select and step through */
export function FlowsPanel() {
  const flows = useCanvasStore((s) => s.doc.flows);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs text-text-muted">
          {flows.length} flow{flows.length === 1 ? '' : 's'}
        </span>
        {!creating && (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> New flow
          </Button>
        )}
      </div>
      {creating && <NewFlowForm onDone={() => setCreating(false)} />}
      {flows.length === 0 && !creating && (
        <p className="px-4 py-2 text-text-muted">
          No flows yet. A flow is a named path through the canvas, like “Checkout”: screen → endpoint → table.
        </p>
      )}
      <ul className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {flows.map((f) => (
          <FlowItem key={f.id} flow={f} />
        ))}
      </ul>
    </div>
  );
}

function NewFlowForm({ onDone }: { onDone(): void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(() => nextFlowColor(useCanvasStore.getState().doc));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = useCanvasStore.getState().addFlow({ name: name.trim(), color });
    useUiStore.getState().startRecording(id);
    onDone();
  };

  return (
    <form onSubmit={submit} className="mx-2 mb-2 grid gap-2 rounded-lg border border-border bg-surface-raised p-3">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
        placeholder="Flow name, e.g. Checkout"
        aria-label="Flow name"
        className={controlClass}
      />
      <ColorSwatches value={color} onChange={setColor} />
      <div className="flex justify-end gap-2">
        <Button className="px-2 py-1 text-xs" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="px-2 py-1 text-xs" disabled={!name.trim()}>
          <Circle className="size-3 fill-current" /> Start recording
        </Button>
      </div>
    </form>
  );
}

function FlowItem({ flow }: { flow: Flow }) {
  const doc = useCanvasStore((s) => s.doc);
  const active = useUiStore((s) => s.activeFlowId === flow.id);
  const recording = useUiStore((s) => s.flowRecording && s.activeFlowId === flow.id);
  const playhead = useUiStore((s) => (s.activeFlowId === flow.id ? s.playhead : null));
  const ui = useUiStore.getState;
  const color = flowColorVar(flow.color);

  const remove = () => {
    if (window.confirm(`Delete the flow "${flow.name}"? Its edges stay on the canvas.`))
      useCanvasStore.getState().removeFlow(flow.id);
  };

  return (
    <li className={`mb-1 rounded-lg ${active ? 'bg-surface-raised' : ''}`}>
      <div className="group flex items-center gap-1 pr-1">
        <button
          type="button"
          aria-pressed={active}
          onClick={() => ui().selectFlow(active ? null : flow.id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-raised"
        >
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate font-medium">{flow.name}</span>
          <span className="ml-auto shrink-0 text-xs text-text-muted">
            {flow.steps.length} step{flow.steps.length === 1 ? '' : 's'}
          </span>
        </button>
        <div className={`flex ${active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
          <IconAction label={`Record steps for ${flow.name}`} onClick={() => ui().startRecording(flow.id)}>
            <Circle className={`size-3.5 ${recording ? 'fill-danger text-danger' : ''}`} />
          </IconAction>
          <IconAction label={`Edit ${flow.name}`} onClick={() => ui().openDialog({ kind: 'flow', id: flow.id })}>
            <Pencil className="size-3.5" />
          </IconAction>
          <IconAction label={`Delete ${flow.name}`} onClick={remove}>
            <Trash2 className="size-3.5" />
          </IconAction>
          {active && (
            <IconAction label="Show whole canvas" onClick={() => ui().selectFlow(null)}>
              <Eye className="size-3.5" />
            </IconAction>
          )}
        </div>
      </div>

      {active && (
        <div className="px-2 pb-2">
          {flow.description && <p className="mb-1.5 px-1 text-xs text-text-muted">{flow.description}</p>}
          {flow.steps.length === 0 ? (
            <p className="px-1 text-xs text-text-muted">
              {recording ? 'Click edges on the canvas in order.' : 'No steps yet. Press record to add some.'}
            </p>
          ) : (
            <>
              <ol className="grid gap-0.5">
                {flow.steps.map((step, i) => (
                  <li key={step.edgeId}>
                    <button
                      type="button"
                      aria-current={playhead === i ? 'step' : undefined}
                      onClick={() => ui().setPlayhead(i)}
                      className={`flex w-full items-start gap-2 rounded-md px-1 py-1 text-left text-xs ${
                        playhead === i ? 'bg-surface' : 'hover:bg-surface'
                      }`}
                    >
                      <span
                        className="flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold text-canvas"
                        style={{ background: color }}
                      >
                        {i + 1}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <StepLabel doc={doc} edgeId={step.edgeId} />
                        {step.note && <span className="text-text-muted">{step.note}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {!recording && <p className="mt-1.5 px-1 text-[11px] text-text-muted">← → to step through · Esc or click the canvas to show everything</p>}
            </>
          )}
        </div>
      )}
    </li>
  );
}
