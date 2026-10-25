import { CanvasNode, type CanvasDoc } from '@flowcanvas/shared';
import { moveNodes, removeElements } from './docOps';
import { newId, type Position } from './nodeFactory';

/*
 * Pure doc transforms for frames and arranging: children of a frame store positions relative to it
 * (as React Flow expects), so anything that changes a node's frame converts its position. Frames
 * don't nest, so a node's absolute position is its own plus its frame's.
 */

export type Size = { width: number; height: number };
/** A node's rendered size: its stored size, or what React Flow measured */
export type SizeOf = (node: CanvasNode) => Size;
export type Rect = { id: string; x: number; y: number; width: number; height: number };

/** Space around grouped nodes; more on top for the frame's title */
export const GROUP_PAD = { side: 32, top: 48 };

export function absolutePosition(doc: CanvasDoc, node: CanvasNode): Position {
  const parent = node.parentId ? doc.nodes.find((n) => n.id === node.parentId) : undefined;
  return parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position;
}

/** Absolute rects of nodes, in doc order */
export function rectsOf(doc: CanvasDoc, ids: Iterable<string>, sizeOf: SizeOf): Rect[] {
  const wanted = new Set(ids);
  return doc.nodes
    .filter((n) => wanted.has(n.id))
    .map((n) => ({ id: n.id, ...absolutePosition(doc, n), ...sizeOf(n) }));
}

/** Moves nodes to absolute positions, keeping each in its frame (positions become relative to it) */
export function moveNodesAbsolute(doc: CanvasDoc, positions: Record<string, Position>): CanvasDoc {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const relative: Record<string, Position> = {};
  for (const [id, p] of Object.entries(positions)) {
    const node = nodes.get(id);
    if (!node) continue;
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    relative[id] = parent ? { x: p.x - parent.position.x, y: p.y - parent.position.y } : p;
  }
  return moveNodes(doc, relative);
}

/** Puts a node into a frame (or none), keeping it where it is on the canvas */
function withParent(doc: CanvasDoc, node: CanvasNode, frame: CanvasNode | undefined): CanvasNode {
  const abs = absolutePosition(doc, node);
  const position = frame ? { x: abs.x - frame.position.x, y: abs.y - frame.position.y } : abs;
  return { ...node, parentId: frame?.id, position };
}

/** The topmost frame whose area holds the center of `node` */
export function frameAt(doc: CanvasDoc, node: CanvasNode, sizeOf: SizeOf): CanvasNode | undefined {
  const abs = absolutePosition(doc, node);
  const { width, height } = sizeOf(node);
  const cx = abs.x + width / 2;
  const cy = abs.y + height / 2;
  return doc.nodes.findLast((f) => {
    if (f.type !== 'frame' || f.id === node.id) return false;
    const size = sizeOf(f);
    return cx >= f.position.x && cx <= f.position.x + size.width && cy >= f.position.y && cy <= f.position.y + size.height;
  });
}

/** After a drag: moved nodes join the frame they were dropped in, or leave the one they were dragged out of */
export function dropIntoFrames(doc: CanvasDoc, ids: Iterable<string>, sizeOf: SizeOf): CanvasDoc {
  const moved = new Set(ids);
  let changed = false;
  const nodes = doc.nodes.map((n) => {
    if (!moved.has(n.id) || n.type === 'frame') return n;
    const frame = frameAt(doc, n, sizeOf);
    if (frame?.id === n.parentId) return n;
    changed = true;
    return withParent(doc, n, frame);
  });
  return changed ? { ...doc, nodes } : doc;
}

/**
 * Wraps nodes in a new frame sized to their bounding box (frames in the selection are left out:
 * frames don't nest). Returns the frame id, or null when there is nothing to group.
 */
export function groupIntoFrame(
  doc: CanvasDoc,
  ids: Iterable<string>,
  sizeOf: SizeOf,
  label = 'Group',
): { doc: CanvasDoc; frameId: string | null } {
  const rects = rectsOf(doc, ids, sizeOf).filter((r) => doc.nodes.find((n) => n.id === r.id)?.type !== 'frame');
  if (rects.length === 0) return { doc, frameId: null };
  const x = Math.min(...rects.map((r) => r.x)) - GROUP_PAD.side;
  const y = Math.min(...rects.map((r) => r.y)) - GROUP_PAD.top;
  const right = Math.max(...rects.map((r) => r.x + r.width)) + GROUP_PAD.side;
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + GROUP_PAD.side;
  const frame = CanvasNode.parse({
    id: newId(),
    type: 'frame',
    label,
    position: { x: Math.round(x), y: Math.round(y) },
    size: { width: Math.round(right - x), height: Math.round(bottom - y) },
    data: { lane: 'none' },
  });
  const members = new Set(rects.map((r) => r.id));
  const withFrame = { ...doc, nodes: [frame, ...doc.nodes] };
  const nodes = withFrame.nodes.map((n) => (members.has(n.id) ? withParent(withFrame, n, frame) : n));
  return { doc: { ...doc, nodes }, frameId: frame.id };
}

/** Removes frames and keeps their children where they are */
export const ungroup = (doc: CanvasDoc, frameIds: Iterable<string>): CanvasDoc => {
  const frames = new Set([...frameIds].filter((id) => doc.nodes.find((n) => n.id === id)?.type === 'frame'));
  return frames.size ? removeElements(doc, frames) : doc;
};
