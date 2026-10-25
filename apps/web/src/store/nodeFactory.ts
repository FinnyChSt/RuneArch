import { CanvasNode, DIALECTS, type CanvasDoc, type NodeType } from '@flowcanvas/shared';
import { nanoid } from 'nanoid';

/** Node types that can be created from the toolbar */
export const CREATABLE_NODE_TYPES = ['screen', 'component', 'endpoint', 'service', 'job', 'table', 'frame'] as const satisfies readonly NodeType[];
export type CreatableNodeType = (typeof CREATABLE_NODE_TYPES)[number];

/** Sketch shapes placed with a click (pen strokes are drawn instead, see createStroke) */
export const SKETCH_SHAPES = ['rect', 'ellipse', 'text', 'sticky'] as const;
export type SketchShape = (typeof SKETCH_SHAPES)[number];

/** Everything a click on the canvas can place: a node type or a sketch shape */
export type Placeable = CreatableNodeType | SketchShape;

/** Default size of frames and sketch shapes (other nodes size themselves) */
export const PLACE_SIZE: Record<'frame' | SketchShape, { width: number; height: number }> = {
  frame: { width: 480, height: 320 },
  rect: { width: 160, height: 100 },
  ellipse: { width: 140, height: 100 },
  text: { width: 160, height: 40 },
  sticky: { width: 180, height: 160 },
};

export type Position = CanvasNode['position'];

export const newId = () => nanoid(10);

/** Returns `base`, or `base-2`, `base-3`, ... so that `method path` stays unique in the doc */
export function uniquePath(doc: CanvasDoc, method: string, base: string): string {
  const routes = new Set(
    doc.nodes.flatMap((n) => (n.type === 'endpoint' ? [`${n.data.method} ${n.data.path}`] : [])),
  );
  let path = base;
  for (let i = 2; routes.has(`${method} ${path}`); i++) path = `${base}-${i}`;
  return path;
}

/** `base`, or `base_2`, `base_3`, ... unique among nodes of `type` (case-insensitive, like SQL names) */
function uniqueLabel(doc: CanvasDoc, type: NodeType, base: string): string {
  const labels = new Set(doc.nodes.filter((n) => n.type === type).map((n) => n.label.toLowerCase()));
  let label = base;
  for (let i = 2; labels.has(label.toLowerCase()); i++) label = `${base}_${i}`;
  return label;
}

/** Builds a valid node with defaults; parsing through the shared schema fills in the rest */
export function createNode(doc: CanvasDoc, type: Placeable, position: Position): CanvasNode {
  const base = { id: newId(), position };
  switch (type) {
    case 'frame':
      return CanvasNode.parse({ ...base, type, label: 'Frame', size: PLACE_SIZE.frame, data: { lane: 'none' } });
    case 'rect':
    case 'ellipse':
    case 'sticky':
    case 'text':
      return CanvasNode.parse({
        ...base,
        type: 'sketch',
        size: PLACE_SIZE[type],
        data: { shape: type, text: type === 'text' ? 'Text' : undefined },
      });
    case 'screen':
      return CanvasNode.parse({ ...base, type, label: 'New screen', data: { route: '/' } });
    case 'component':
      return CanvasNode.parse({ ...base, type, label: uniqueLabel(doc, type, 'NewComponent'), data: {} });
    case 'endpoint':
      return CanvasNode.parse({ ...base, type, data: { method: 'GET', path: uniquePath(doc, 'GET', '/resource') } });
    case 'service':
      return CanvasNode.parse({ ...base, type, label: uniqueLabel(doc, type, 'NewService'), data: {} });
    case 'job':
      return CanvasNode.parse({ ...base, type, label: uniqueLabel(doc, type, 'NewEvent'), data: { trigger: 'event' } });
    case 'table':
      return CanvasNode.parse({
        ...base,
        type,
        label: uniqueLabel(doc, type, 'new_table'),
        data: {
          columns: [{ id: newId(), name: 'id', type: DIALECTS[doc.database.dialect].idType, primaryKey: true, nullable: false }],
        },
      });
  }
}

/** Copies a node with fresh ids (node and columns); endpoint routes stay unique */
export function cloneNode(doc: CanvasDoc, node: CanvasNode, offset: Position): CanvasNode {
  const position = { x: node.position.x + offset.x, y: node.position.y + offset.y };
  const clone = { ...structuredClone(node), id: newId(), position };
  if (clone.type === 'endpoint') clone.data.path = uniquePath(doc, clone.data.method, clone.data.path);
  if (clone.type === 'table') {
    // Table names must be unique
    clone.label = uniqueLabel(doc, 'table', node.label);
    const colIds = new Map(clone.data.columns.map((c) => [c.id, newId()]));
    clone.data.columns = clone.data.columns.map((c) => ({ ...c, id: colIds.get(c.id)! }));
    clone.data.indexes = clone.data.indexes.map((ix) => ({
      ...ix,
      id: newId(),
      columnIds: ix.columnIds.map((id) => colIds.get(id) ?? id),
    }));
  }
  return clone;
}

/** Pen stroke margin (flow px) around the points, so the stroke's width isn't clipped */
export const STROKE_PAD = 8;

/**
 * A pen stroke from points in flow coordinates ([x, y, pressure]): the node sits at the stroke's
 * top-left (less a margin) and keeps its points relative to that.
 */
export function createStroke(points: readonly (readonly [number, number, number])[]): CanvasNode {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - STROKE_PAD;
  const y = Math.min(...ys) - STROKE_PAD;
  const round = (n: number) => Math.round(n * 10) / 10;
  return CanvasNode.parse({
    id: newId(),
    type: 'sketch',
    position: { x: round(x), y: round(y) },
    size: {
      width: Math.max(1, round(Math.max(...xs) - x + STROKE_PAD)),
      height: Math.max(1, round(Math.max(...ys) - y + STROKE_PAD)),
    },
    data: { shape: 'freehand', points: points.map(([px, py, pressure]) => [round(px - x), round(py - y), round(pressure)]) },
  });
}
