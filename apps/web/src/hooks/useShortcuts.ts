import { useReactFlow } from '@xyflow/react';
import { useEffect } from 'react';
import { groupSelection, layoutSelection, ungroupSelection } from '../canvas/arrangeActions';
import { FIT_VIEW_OPTIONS } from '../canvas/fitView';
import { openNodeDialog } from '../dialogs/openNodeDialog';
import { redo, undo, useCanvasStore } from '../store/canvasStore';
import { useUiStore, type Tool } from '../store/uiStore';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'pan',
  s: 'screen',
  c: 'component',
  e: 'endpoint',
  t: 'table',
  j: 'job',
  f: 'frame',
  r: 'rect',
  o: 'ellipse',
  a: 'arrow',
  x: 'text',
  n: 'sticky',
  p: 'pen',
};

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Moves the playhead of the active flow; the first → starts at step 1 */
function stepThrough(delta: 1 | -1) {
  const ui = useUiStore.getState();
  const steps = useCanvasStore.getState().doc.flows.find((f) => f.id === ui.activeFlowId)?.steps.length ?? 0;
  if (steps === 0) return;
  const next = ui.playhead === null ? 0 : Math.min(steps - 1, Math.max(0, ui.playhead + delta));
  ui.setPlayhead(next);
}

/** Global canvas shortcuts (ARCHITECTURE.md §7). Must be used inside a ReactFlowProvider. */
export function useShortcuts() {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      // Dialogs own the keyboard: Delete on a focused checkbox must not delete nodes
      if (ui.dialog || isTyping(e.target) || e.altKey) return;
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (mod) {
        if (key === 'z' && !e.shiftKey) undo();
        else if ((key === 'z' && e.shiftKey) || key === 'y') redo();
        else if (key === 'd') ui.setSelection(useCanvasStore.getState().duplicate(ui.selection));
        else if (key === 'g' && e.shiftKey) ungroupSelection();
        else if (key === 'g') groupSelection();
        else return;
        e.preventDefault();
        return;
      }

      if (e.shiftKey && e.code === 'Digit1') {
        void fitView({ ...FIT_VIEW_OPTIONS, duration: 200 });
      } else if (e.shiftKey && key === 'l') {
        void layoutSelection();
      } else if (key === 'delete' || key === 'backspace') {
        if (ui.selection.length === 0) return;
        useCanvasStore.getState().removeElements(ui.selection);
        ui.setSelection([]);
      } else if (key === 'enter' && ui.selection.length === 1) {
        if (!openNodeDialog(ui.selection[0]!)) return;
      } else if ((key === 'arrowright' || key === 'arrowleft') && ui.activeFlowId && !ui.flowRecording) {
        stepThrough(key === 'arrowright' ? 1 : -1);
      } else if (key === 'escape') {
        // Innermost first: stop recording, then drop the flow highlight, then the tool and selection
        if (ui.flowRecording) ui.stopRecording();
        else if (ui.activeFlowId) ui.selectFlow(null);
        else {
          ui.setTool('select');
          ui.setSelection([]);
        }
      } else if (!e.shiftKey && TOOL_KEYS[key]) {
        ui.setTool(TOOL_KEYS[key]);
      } else {
        return;
      }
      e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fitView]);
}
