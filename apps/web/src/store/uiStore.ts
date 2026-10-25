import { create } from 'zustand';
import type { FeatureItemRef } from '@flowcanvas/shared';
import type { Placeable } from './nodeFactory';

/** Select and pan; place a node or sketch shape with a click; draw with the pen; connect anything with an arrow */
export type Tool = 'select' | 'pan' | 'pen' | 'arrow' | Placeable;

export type Dialog = {
  kind: 'table' | 'endpoint' | 'screen' | 'component' | 'frame' | 'service' | 'job' | 'edge' | 'model' | 'flow' | 'feature' | 'featureExport' | 'spec' | 'schema' | 'code' | 'screens' | 'export' | 'import' | 'snapshot';
  id?: string;
  /** Table dialog: column to focus (e.g. when opened from an FK edge) */
  focusColumnId?: string;
};

type UiState = {
  tool: Tool;
  /** Ids of selected nodes and edges */
  selection: string[];
  /** Highlighted flow; everything else is dimmed */
  activeFlowId: string | null;
  /** Clicking edges appends them to the active flow */
  flowRecording: boolean;
  /** Current step index while stepping through the active flow */
  playhead: number | null;
  /** Highlighted feature: its items carry role badges, everything else is dimmed */
  viewFeatureId: string | null;
  /** Hides what unshipped features add (except the viewed feature's and the one being worked on) */
  hideUnshipped: boolean;
  /** Right-click menu on a node or edge, at screen coordinates */
  contextMenu: ContextMenu | null;
  dialog: Dialog | null;
  rightPanel: 'flows' | 'features' | 'api' | 'history' | null;
  /** Sketch node whose text is being edited in place */
  editingId: string | null;
  /** Short transient message, e.g. why a connection was rejected */
  hint: { id: number; message: string } | null;
  /** Asks the canvas to fit these nodes into view (e.g. after an import); empty = everything */
  fitRequest: { id: number; nodeIds: string[] } | null;

  setTool(tool: Tool): void;
  setSelection(ids: string[]): void;
  /** Applies React Flow select changes (one entry per node/edge) */
  applySelectChanges(changes: { id: string; selected: boolean }[]): void;
  setRightPanel(panel: UiState['rightPanel']): void;
  /** Highlights a flow (null clears it); stops any recording and clears the feature highlight */
  selectFlow(id: string | null): void;
  /** Highlights a feature (null clears it) and clears the flow highlight */
  selectFeature(id: string | null): void;
  setHideUnshipped(hide: boolean): void;
  openContextMenu(menu: ContextMenu): void;
  closeContextMenu(): void;
  startRecording(flowId: string): void;
  stopRecording(): void;
  setPlayhead(index: number | null): void;
  openDialog(dialog: Dialog): void;
  closeDialog(): void;
  setEditing(id: string | null): void;
  showHint(message: string): void;
  clearHint(id: number): void;
  requestFit(nodeIds?: string[]): void;
};

export type ContextMenu = { x: number; y: number; ref: FeatureItemRef };

/** Tools that place something where the canvas is clicked */
export const isNodeTool = (tool: Tool): tool is Placeable =>
  tool !== 'select' && tool !== 'pan' && tool !== 'pen' && tool !== 'arrow';

export const useUiStore = create<UiState>()((set, get) => ({
  tool: 'select',
  selection: [],
  activeFlowId: null,
  flowRecording: false,
  playhead: null,
  viewFeatureId: null,
  hideUnshipped: false,
  contextMenu: null,
  dialog: null,
  rightPanel: 'flows',
  hint: null,
  editingId: null,
  fitRequest: null,

  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),
  applySelectChanges: (changes) => {
    if (changes.length === 0) return;
    const selection = new Set(get().selection);
    for (const c of changes) {
      if (c.selected) selection.add(c.id);
      else selection.delete(c.id);
    }
    set({ selection: [...selection] });
  },
  setRightPanel: (rightPanel) => set({ rightPanel }),
  selectFlow: (activeFlowId) =>
    set((s) => ({ activeFlowId, flowRecording: false, playhead: null, viewFeatureId: activeFlowId ? null : s.viewFeatureId })),
  selectFeature: (viewFeatureId) =>
    set(viewFeatureId ? { viewFeatureId, activeFlowId: null, flowRecording: false, playhead: null } : { viewFeatureId }),
  setHideUnshipped: (hideUnshipped) => set({ hideUnshipped }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  startRecording: (flowId) =>
    set({ activeFlowId: flowId, flowRecording: true, playhead: null, viewFeatureId: null, rightPanel: 'flows', tool: 'select' }),
  stopRecording: () => set({ flowRecording: false }),
  setPlayhead: (playhead) => set({ playhead }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setEditing: (editingId) => set({ editingId }),
  showHint: (message) => set({ hint: { id: Date.now(), message } }),
  clearHint: (id) => set((s) => (s.hint?.id === id ? { hint: null } : s)),
  requestFit: (nodeIds = []) => set({ fitRequest: { id: Date.now(), nodeIds } }),
}));
