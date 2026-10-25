import { useCanvasStore } from '../store/canvasStore';
import { rectsOf, type Rect } from '../store/layoutOps';
import { useUiStore } from '../store/uiStore';
import { align, autoLayout, distribute, type AlignMode } from './arrange';

/*
 * Selection commands for the selection bar and shortcuts. Each is one undo step. Children whose
 * frame is also selected move with the frame, so they aren't arranged on their own.
 */

/** Selected nodes to arrange, as absolute rects */
export function selectionRects(): Rect[] {
  const { doc, sizeOf } = useCanvasStore.getState();
  const selected = new Set(useUiStore.getState().selection);
  const ids = doc.nodes.filter((n) => selected.has(n.id) && !(n.parentId && selected.has(n.parentId))).map((n) => n.id);
  return rectsOf(doc, ids, sizeOf);
}

export function alignSelection(mode: AlignMode) {
  const rects = selectionRects();
  if (rects.length >= 2) useCanvasStore.getState().arrange(align(rects, mode));
}

export function distributeSelection(axis: 'horizontal' | 'vertical') {
  const rects = selectionRects();
  if (rects.length >= 3) useCanvasStore.getState().arrange(distribute(rects, axis));
}

/** Lays out the selection by its connections; a selected frame stands in for its children's edges */
export async function layoutSelection() {
  const rects = selectionRects();
  if (rects.length < 2) return;
  const { doc } = useCanvasStore.getState();
  const items = new Set(rects.map((r) => r.id));
  const parents = new Map(doc.nodes.map((n) => [n.id, n.parentId]));
  const itemOf = (id: string) => (items.has(id) ? id : (parents.get(id) ?? id));
  const edges = doc.edges.map((e) => ({ source: itemOf(e.source), target: itemOf(e.target) }));
  const positions = await autoLayout(rects, edges);
  useCanvasStore.getState().arrange(positions);
}

export function groupSelection() {
  const ui = useUiStore.getState();
  const frameId = useCanvasStore.getState().group(ui.selection);
  if (frameId) ui.setSelection([frameId]);
  else ui.showHint('Select nodes to group (frames cannot go inside other frames)');
}

export function ungroupSelection() {
  const ui = useUiStore.getState();
  const { doc, ungroup } = useCanvasStore.getState();
  const frames = new Set(doc.nodes.filter((n) => n.type === 'frame').map((n) => n.id));
  const selectedFrames = ui.selection.filter((id) => frames.has(id));
  if (selectedFrames.length === 0) return;
  const children = doc.nodes.filter((n) => n.parentId && selectedFrames.includes(n.parentId)).map((n) => n.id);
  ungroup(selectedFrames);
  ui.setSelection(children);
}
