import {
  checkFlowSteps,
  elementHandleId,
  elementIdOf,
  isInteractive,
  pruneFeatures,
  type ApiModel,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type Feature,
  type Flow,
  type TableNode,
} from '@flowcanvas/shared';
import { inferEdgeKind } from '../canvas/connectRules';
import { cloneNode, newId, type Position } from './nodeFactory';

/*
 * Pure CanvasDoc transformations. Each returns a new doc (or the same doc if nothing changed)
 * and keeps the document valid under CanvasDoc.parse.
 */

/** Frames go first: they draw behind other nodes, and React Flow needs parents before children */
export function addNode(doc: CanvasDoc, node: CanvasNode): CanvasDoc {
  return { ...doc, nodes: node.type === 'frame' ? [node, ...doc.nodes] : [...doc.nodes, node] };
}

export function moveNodes(doc: CanvasDoc, positions: Record<string, Position>): CanvasDoc {
  let changed = false;
  const nodes = doc.nodes.map((n) => {
    const p = positions[n.id];
    if (!p || (p.x === n.position.x && p.y === n.position.y)) return n;
    changed = true;
    return { ...n, position: { x: p.x, y: p.y } };
  });
  return changed ? { ...doc, nodes } : doc;
}

/** Stores new sizes (frames and sketches resized on the canvas), rounded to whole pixels */
export function resizeNodes(doc: CanvasDoc, sizes: Record<string, { width: number; height: number }>): CanvasDoc {
  if (Object.keys(sizes).length === 0) return doc;
  const nodes = doc.nodes.map((n) => {
    const size = sizes[n.id];
    return size ? { ...n, size: { width: Math.round(size.width), height: Math.round(size.height) } } : n;
  });
  return { ...doc, nodes };
}

export function replaceNode(doc: CanvasDoc, node: CanvasNode): CanvasDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === node.id ? node : n)) };
}

export function addEdge(doc: CanvasDoc, edge: CanvasEdge): CanvasDoc {
  return { ...doc, edges: [...doc.edges, edge] };
}

export function replaceEdge(doc: CanvasDoc, edge: CanvasEdge): CanvasDoc {
  return { ...doc, edges: doc.edges.map((e) => (e.id === edge.id ? edge : e)) };
}

/** Keeps the steps that are still valid (edge exists, flow still continues); the flow itself stays */
function pruneFlow(flow: Flow, edges: Map<string, CanvasEdge>): Flow {
  const kept: Flow['steps'] = [];
  for (const step of flow.steps) if (!checkFlowSteps(edges, [...kept, step]).at(-1)) kept.push(step);
  return kept.length === flow.steps.length ? flow : { ...flow, steps: kept };
}

/** A screen without its instances of the given components (removed along with them) */
function withoutInstances(node: CanvasNode, components: ReadonlySet<string>): CanvasNode {
  const wireframe = node.type === 'screen' ? node.data.wireframe : undefined;
  if (!wireframe?.elements.some((el) => el.componentId && components.has(el.componentId))) return node;
  const elements = wireframe.elements.filter((el) => !(el.componentId && components.has(el.componentId)));
  return { ...node, data: { ...node.data, wireframe: { ...wireframe, elements } } } as CanvasNode;
}

/** Removes nodes and edges by id, plus edges attached to removed nodes, the flow steps using them and their feature items */
export function removeElements(doc: CanvasDoc, ids: Iterable<string>): CanvasDoc {
  const remove = new Set(ids);
  const components = new Set(doc.nodes.filter((n) => n.type === 'component' && remove.has(n.id)).map((n) => n.id));
  const nodes = doc.nodes
    .filter((n) => !remove.has(n.id))
    // Children of a removed frame stay where they are: their relative position becomes absolute
    .map((n) => {
      const parent = n.parentId && remove.has(n.parentId) ? doc.nodes.find((p) => p.id === n.parentId) : undefined;
      return parent
        ? { ...n, parentId: undefined, position: { x: parent.position.x + n.position.x, y: parent.position.y + n.position.y } }
        : n;
    })
    .map((n) => (components.size > 0 ? withoutInstances(n, components) : n));
  const edges = doc.edges.filter((e) => !remove.has(e.id) && !remove.has(e.source) && !remove.has(e.target));
  if (nodes.length === doc.nodes.length && edges.length === doc.edges.length) return doc;

  const edgeMap = new Map(edges.map((e) => [e.id, e]));
  const flows = doc.flows.map((f) => pruneFlow(f, edgeMap));
  return pruneFeatures({ ...doc, nodes, edges, flows });
}

/** Duplicates nodes and the link edges between them. Returns the new doc and the ids of the copies. */
export function duplicate(
  doc: CanvasDoc,
  ids: Iterable<string>,
  offset: Position = { x: 32, y: 32 },
): { doc: CanvasDoc; ids: string[] } {
  const selected = new Set(ids);
  const idMap = new Map<string, string>();
  const columnMap = new Map<string, string>();
  let next = doc;
  const framesFirst = [...doc.nodes.filter((n) => n.type === 'frame'), ...doc.nodes.filter((n) => n.type !== 'frame')];
  for (const node of framesFirst) {
    if (!selected.has(node.id)) continue;
    // A child copied with its frame keeps its place inside the copy
    const withFrame = node.parentId !== undefined && idMap.has(node.parentId);
    const clone = cloneNode(next, node, withFrame ? { x: 0, y: 0 } : offset);
    if (withFrame) clone.parentId = idMap.get(node.parentId!);
    idMap.set(node.id, clone.id);
    if (node.type === 'table' && clone.type === 'table')
      node.data.columns.forEach((c, i) => columnMap.set(c.id, clone.data.columns[i]!.id));
    next = addNode(next, clone);
  }
  for (const edge of doc.edges) {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) continue;
    const ends = { id: newId(), source, target };
    const copy: CanvasEdge =
      edge.kind === 'fk'
        ? {
            ...edge,
            ...ends,
            data: {
              ...edge.data,
              sourceColumnId: columnMap.get(edge.data.sourceColumnId)!,
              targetColumnId: columnMap.get(edge.data.targetColumnId)!,
            },
          }
        : { ...edge, ...ends };
    idMap.set(edge.id, copy.id);
    next = addEdge(next, copy);
  }
  return { doc: next, ids: [...idMap.values()] };
}

type FkEdge = Extract<CanvasEdge, { kind: 'fk' }>;

/** What a table dialog says about one column's foreign key */
export type ColumnRef = {
  columnId: string;
  /** Referenced column, or null for no foreign key */
  target: { tableId: string; columnId: string } | null;
  onDelete: FkEdge['data']['onDelete'];
};

/**
 * Applies a table dialog: replaces the table, then syncs its outgoing FK edges with `refs`
 * (one per column) and drops FK edges (in or out) whose column no longer exists.
 */
export function applyTableEdit(doc: CanvasDoc, table: TableNode, refs: ColumnRef[]): CanvasDoc {
  const columns = new Map(table.data.columns.map((c) => [c.id, c]));
  const removed = new Set<string>();
  let edges = doc.edges;

  for (const e of edges) {
    if (e.kind !== 'fk') continue;
    const lostSource = e.source === table.id && !columns.has(e.data.sourceColumnId);
    const lostTarget = e.target === table.id && !columns.has(e.data.targetColumnId);
    if (lostSource || lostTarget) removed.add(e.id);
  }

  for (const ref of refs) {
    const column = columns.get(ref.columnId);
    if (!column) continue;
    const existing = edges.find(
      (e): e is FkEdge => e.kind === 'fk' && e.source === table.id && e.data.sourceColumnId === ref.columnId,
    );
    if (!ref.target) {
      if (existing) removed.add(existing.id);
      continue;
    }
    const data: FkEdge['data'] = {
      sourceColumnId: ref.columnId,
      targetColumnId: ref.target.columnId,
      cardinality: column.primaryKey || column.unique ? '1:1' : 'n:1',
      onDelete: ref.onDelete,
    };
    const unchanged =
      existing &&
      existing.target === ref.target.tableId &&
      (Object.keys(data) as (keyof typeof data)[]).every((k) => existing.data[k] === data[k]);
    if (unchanged) continue;
    edges = existing
      ? edges.map((e) => (e.id === existing.id ? { ...existing, target: ref.target!.tableId, data } : e))
      : [...edges, { id: newId(), kind: 'fk', source: table.id, target: ref.target.tableId, data }];
  }

  return removeElements({ ...replaceNode(doc, table), edges }, removed);
}

type ScreenNode = Extract<CanvasNode, { type: 'screen' }>;

/** A link from one wireframe element of a screen (a button, a form, ...) to a node; `id` is the edge id */
export type ElementLink = { id: string; elementId: string; targetId: string };

/**
 * Applies a screen dialog: replaces the screen, then syncs the edges that start at its wireframe
 * elements with `links`. Links whose element is gone (or no longer interactive) are dropped along
 * with their edges and flow steps; new links become edges with the kind the connect rules pick.
 */
export function applyScreenEdit(doc: CanvasDoc, screen: ScreenNode, links: readonly ElementLink[]): CanvasDoc {
  const elements = new Set(screen.data.wireframe?.elements.filter((el) => isInteractive(el.kind)).map((el) => el.id));
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const kept = links.filter((l) => elements.has(l.elementId) && nodes.has(l.targetId) && l.targetId !== screen.id);
  const keptIds = new Set(kept.map((l) => l.id));

  const dropped = doc.edges
    .filter((e) => e.source === screen.id && elementIdOf(e.sourceHandle) !== null && !keptIds.has(e.id))
    .map((e) => e.id);
  let next = removeElements(replaceNode(doc, screen), dropped);

  const existing = new Set(next.edges.map((e) => e.id));
  for (const link of kept) {
    if (existing.has(link.id)) continue;
    const result = inferEdgeKind(screen, nodes.get(link.targetId)!);
    if (!result.ok) continue;
    next = addEdge(next, {
      id: link.id,
      kind: result.kind,
      source: screen.id,
      target: link.targetId,
      sourceHandle: elementHandleId(link.elementId),
    });
  }
  return next;
}

/** The element links of a screen, as the screen dialog edits them */
export const elementLinksOf = (doc: CanvasDoc, screenId: string): ElementLink[] =>
  doc.edges.flatMap((e) => {
    const elementId = e.source === screenId ? elementIdOf(e.sourceHandle) : null;
    return elementId === null ? [] : [{ id: e.id, elementId, targetId: e.target }];
  });

export function addFlow(doc: CanvasDoc, flow: Flow): CanvasDoc {
  return { ...doc, flows: [...doc.flows, flow] };
}

export function replaceFlow(doc: CanvasDoc, flow: Flow): CanvasDoc {
  return { ...doc, flows: doc.flows.map((f) => (f.id === flow.id ? flow : f)) };
}

export function removeFlow(doc: CanvasDoc, id: string): CanvasDoc {
  return pruneFeatures({ ...doc, flows: doc.flows.filter((f) => f.id !== id) });
}

/** Adds the model, or replaces the one with the same id */
export function upsertModel(doc: CanvasDoc, model: ApiModel): CanvasDoc {
  const exists = doc.models.some((m) => m.id === model.id);
  return { ...doc, models: exists ? doc.models.map((m) => (m.id === model.id ? model : m)) : [...doc.models, model] };
}

export function removeModel(doc: CanvasDoc, id: string): CanvasDoc {
  return pruneFeatures({ ...doc, models: doc.models.filter((m) => m.id !== id) });
}

export function addFeature(doc: CanvasDoc, feature: Feature): CanvasDoc {
  return { ...doc, features: [...doc.features, feature] };
}

export function replaceFeature(doc: CanvasDoc, feature: Feature): CanvasDoc {
  return { ...doc, features: doc.features.map((f) => (f.id === feature.id ? feature : f)) };
}

export function removeFeature(doc: CanvasDoc, id: string): CanvasDoc {
  return { ...doc, features: doc.features.filter((f) => f.id !== id) };
}
