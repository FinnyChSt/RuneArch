import { elementIdOf, type CanvasDoc, type CanvasEdge, type CanvasNode, type NodeType } from '@flowcanvas/shared';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { roleIn, type ColumnMarks, type FeatureView } from './featureView';
import type { FlowView } from './flowView';
import { columnHandleId, elementSideHandleId, type Side } from './handles';

/*
 * CanvasDoc -> React Flow. React Flow never owns state: these nodes/edges are rebuilt from
 * canvasStore.doc plus transient view state (selection, measured sizes, drag positions).
 */

export type NodeOf<T extends NodeType> = Extract<CanvasNode, { type: T }>;
export type FlowNodeData<T extends NodeType = NodeType> = {
  node: NodeOf<T>;
  /** Tables only: ids of columns holding a foreign key */
  fkColumnIds?: readonly string[];
  /** Screens only: wireframe elements that start steps of the active flow */
  flowMarks?: ElementFlowMarks;
  /** Tables changed by the highlighted feature: column markers against the baseline */
  columnMarks?: ColumnMarks;
  /** Screens changed by the highlighted feature: element id -> added or changed */
  elementMarks?: Readonly<Record<string, 'added' | 'changed'>>;
};
/** Flow steps starting at a screen's elements, drawn on its thumbnail */
export type ElementFlowMarks = {
  color: string;
  /** Element id -> first step number */
  steps: Readonly<Record<string, number>>;
  /** Element of the step at the playhead */
  current?: string;
};
export type FlowNode<T extends NodeType = NodeType> = Node<FlowNodeData<T>, T>;
/** How an edge takes part in the active flow */
export type EdgeFlowState = {
  /** 1-based step number, if the edge is a step */
  step?: number;
  color: string;
  /** Step at the playhead */
  current: boolean;
  /** Not part of the flow (labels live in another layer, so they dim themselves) */
  dimmed: boolean;
  /** Added or changed by the highlighted feature: drawn in its color */
  accent?: boolean;
};
/** Side of a two-way pair (A→B plus B→A): the two edges get opposite signs and are drawn apart */
export type PairSide = 1 | -1;
export type FlowEdge = Edge<{ edge: CanvasEdge; flow?: EdgeFlowState; pair?: PairSide }, 'link' | 'fk'>;

export type NodeGroup = 'fe' | 'be' | 'db' | 'sketch';

export const NODE_GROUP: Record<NodeType, NodeGroup> = {
  screen: 'fe',
  component: 'fe',
  store: 'fe',
  endpoint: 'be',
  service: 'be',
  job: 'be',
  external: 'be',
  table: 'db',
  frame: 'sketch',
  sketch: 'sketch',
};

export type ViewState = {
  selection: ReadonlySet<string>;
  /** Nodes named by the last save's validation errors */
  invalid: ReadonlySet<string>;
  measured: Readonly<Record<string, { width: number; height: number }>>;
  dragPositions: Readonly<Record<string, { x: number; y: number }>>;
  /** Sizes while resizing */
  resizeSizes?: Readonly<Record<string, { width: number; height: number }>>;
  /** Active flow: its nodes and edges are highlighted, the rest dimmed */
  flow?: FlowView | null;
  /** Highlighted feature: its items get role badges, the rest is dimmed */
  feature?: FeatureView | null;
  /** Nodes and edges hidden by "hide unshipped" */
  hidden?: ReadonlySet<string>;
};

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined;

const flowNodeClass = (flow: FlowView | null | undefined, id: string) =>
  flow ? (flow.nodeIds.has(id) ? 'is-active' : 'is-dimmed') : undefined;

/** Role badge class of an item of the highlighted feature (`fc-feat-added`, ...); anything else is dimmed */
function featureClass(feature: FeatureView | null | undefined, ref: { kind: 'node' | 'edge'; id: string }) {
  if (!feature) return undefined;
  const role = roleIn(feature, ref);
  return role ? `fc-feat fc-feat-${role}` : 'is-dimmed';
}

/** Table id -> sorted ids of its columns that hold a foreign key */
export function fkColumnsByTable(doc: CanvasDoc): Map<string, string[]> {
  const byTable = new Map<string, string[]>();
  for (const e of doc.edges) {
    if (e.kind !== 'fk') continue;
    const ids = byTable.get(e.source) ?? [];
    if (!ids.includes(e.data.sourceColumnId)) ids.push(e.data.sourceColumnId);
    byTable.set(e.source, ids);
  }
  for (const ids of byTable.values()) ids.sort();
  return byTable;
}

/** Flow marks for a screen's elements, or undefined when no step of the active flow starts there */
export function elementFlowMarks(flow: FlowView | null | undefined, nodeId: string): ElementFlowMarks | undefined {
  const steps = flow?.elementSteps.get(nodeId);
  if (!flow || !steps) return undefined;
  const current = flow.currentElement?.nodeId === nodeId ? flow.currentElement.elementId : undefined;
  return { color: flow.color, steps: Object.fromEntries(steps), current };
}

export function toFlowNode(
  node: CanvasNode,
  view: ViewState,
  fkColumnIds?: readonly string[],
  flowMarks = node.type === 'screen' ? elementFlowMarks(view.flow, node.id) : undefined,
): FlowNode {
  const measured = view.measured[node.id];
  const size = view.resizeSizes?.[node.id] ?? node.size;
  const columnMarks = view.feature?.columns.get(node.id);
  const elementMarks = view.feature?.elements.get(node.id);
  return {
    id: node.id,
    type: node.type,
    position: view.dragPositions[node.id] ?? node.position,
    data:
      node.type === 'table'
        ? { node, fkColumnIds: fkColumnIds ?? [], ...(columnMarks && { columnMarks }) }
        : { node, ...(flowMarks && { flowMarks }), ...(elementMarks && { elementMarks }) },
    selected: view.selection.has(node.id),
    className: classes(
      view.invalid.has(node.id) && 'fc-invalid',
      flowNodeClass(view.flow, node.id),
      featureClass(view.feature, { kind: 'node', id: node.id }),
    ),
    ...(view.hidden?.has(node.id) && { hidden: true }),
    parentId: node.parentId,
    width: size?.width,
    height: size?.height,
    // Frames sit behind everything; their children draw above them anyway
    ...(node.type === 'frame' && { zIndex: -1 }),
    measured,
  } as FlowNode;
}

type EdgeView = Pick<ViewState, 'selection' | 'measured' | 'dragPositions' | 'flow' | 'feature' | 'hidden'>;

/** Flow (or feature) highlight for one edge: class, data and (while recording) a wider click target */
function edgeFlowProps(edge: CanvasEdge, flow: FlowView | null | undefined, feature?: FeatureView | null) {
  if (!flow) {
    if (!feature) return {};
    const role = roleIn(feature, { kind: 'edge', id: edge.id });
    return {
      className: featureClass(feature, { kind: 'edge', id: edge.id }),
      flow: {
        color: feature.color,
        current: false,
        dimmed: role === undefined,
        accent: role === 'added' || role === 'changed',
      } satisfies EdgeFlowState,
    };
  }
  const step = flow.edgeSteps.get(edge.id);
  const candidate = flow.candidateEdgeIds.has(edge.id);
  const dimmed = !step && !candidate;
  return {
    className: step ? 'is-active' : candidate ? 'is-candidate' : 'is-dimmed',
    flow: { step, color: flow.color, current: flow.currentEdgeId === edge.id, dimmed } satisfies EdgeFlowState,
    interactionWidth: flow.recording ? 28 : undefined,
  };
}

const isHidden = (edge: CanvasEdge, view: EdgeView) =>
  !!view.hidden && (view.hidden.has(edge.id) || view.hidden.has(edge.source) || view.hidden.has(edge.target));

const DEFAULT_NODE_WIDTH = 200;

/** Horizontal center of a node on the canvas, following drags (children are relative to their frame) */
const centerX = (node: CanvasNode | undefined, view: EdgeView, nodes?: ReadonlyMap<string, CanvasNode>): number => {
  if (!node) return 0;
  const parent = node.parentId ? nodes?.get(node.parentId) : undefined;
  const offset = parent ? (view.dragPositions[parent.id] ?? parent.position).x : 0;
  const x = offset + (view.dragPositions[node.id] ?? node.position).x;
  return x + (view.measured[node.id]?.width ?? node.size?.width ?? DEFAULT_NODE_WIDTH) / 2;
};

/** FK ends face each other: leave the source on the side of the target. Self-references loop on the right. */
function fkSides(
  source: CanvasNode | undefined,
  target: CanvasNode | undefined,
  view: EdgeView,
  nodes?: ReadonlyMap<string, CanvasNode>,
): [Side, Side] {
  if (source === target) return ['r', 'r'];
  return centerX(target, view, nodes) < centerX(source, view, nodes) ? ['l', 'r'] : ['r', 'l'];
}

/** Element links leave the element on the side facing their target; other links keep their handle */
function linkSourceHandle(edge: CanvasEdge, view: EdgeView, nodes?: ReadonlyMap<string, CanvasNode>): string | null {
  const elementId = elementIdOf(edge.sourceHandle);
  if (elementId === null) return edge.sourceHandle ?? null;
  const [side] = fkSides(nodes?.get(edge.source), nodes?.get(edge.target), view, nodes);
  return elementSideHandleId(elementId, side);
}

const pairKey = (source: string, target: string) => JSON.stringify([source, target]);

/** Link edges that have a link edge going the other way, with their side of the pair */
export function edgePairs(edges: readonly CanvasEdge[]): Map<string, PairSide> {
  const links = edges.filter((e) => e.kind !== 'fk' && e.source !== e.target);
  const keys = new Set(links.map((e) => pairKey(e.source, e.target)));
  const pairs = new Map<string, PairSide>();
  for (const e of links)
    if (keys.has(pairKey(e.target, e.source))) pairs.set(e.id, e.source < e.target ? 1 : -1);
  return pairs;
}

export function toFlowEdge(
  edge: CanvasEdge,
  view: EdgeView,
  nodes?: ReadonlyMap<string, CanvasNode>,
  pair?: PairSide,
): FlowEdge {
  if (edge.kind === 'fk') {
    // Handles follow the column ids, so renaming or reordering columns keeps the edge attached
    const [sourceSide, targetSide] = fkSides(nodes?.get(edge.source), nodes?.get(edge.target), view, nodes);
    const { flow, ...flowProps } = edgeFlowProps(edge, view.flow, view.feature);
    return {
      ...flowProps,
      ...(isHidden(edge, view) && { hidden: true }),
      id: edge.id,
      type: 'fk',
      source: edge.source,
      target: edge.target,
      sourceHandle: columnHandleId(edge.data.sourceColumnId, sourceSide),
      targetHandle: columnHandleId(edge.data.targetColumnId, targetSide),
      data: { edge, flow },
      selected: view.selection.has(edge.id),
    };
  }
  const { flow, ...flowProps } = edgeFlowProps(edge, view.flow, view.feature);
  return {
    ...flowProps,
    ...(isHidden(edge, view) && { hidden: true }),
    id: edge.id,
    type: 'link',
    source: edge.source,
    target: edge.target,
    sourceHandle: linkSourceHandle(edge, view, nodes),
    targetHandle: edge.targetHandle ?? null,
    data: pair ? { edge, flow, pair } : { edge, flow },
    selected: view.selection.has(edge.id),
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: flow?.step || flow?.accent ? flow.color : 'var(--edge)',
    },
  };
}

/**
 * Returns a mapper that reuses the previous React Flow node object when nothing about it
 * changed, so React Flow can skip re-processing untouched nodes.
 */
export function createNodeMapper() {
  let cache = new Map<string, { key: unknown[]; node: FlowNode }>();
  return (doc: CanvasDoc, view: ViewState): FlowNode[] => {
    const fkColumns = fkColumnsByTable(doc);
    const next = new Map<string, { key: unknown[]; node: FlowNode }>();
    // React Flow needs parents before their children
    const ordered = [...doc.nodes.filter((n) => n.type === 'frame'), ...doc.nodes.filter((n) => n.type !== 'frame')];
    const nodes = ordered.map((n) => {
      const fk = fkColumns.get(n.id);
      const marks = n.type === 'screen' ? elementFlowMarks(view.flow, n.id) : undefined;
      const key = [
        n,
        marks && JSON.stringify(marks),
        view.selection.has(n.id),
        view.invalid.has(n.id),
        view.measured[n.id],
        view.dragPositions[n.id],
        view.resizeSizes?.[n.id],
        fk?.join(),
        flowNodeClass(view.flow, n.id),
        featureClass(view.feature, { kind: 'node', id: n.id }),
        JSON.stringify(view.feature?.columns.get(n.id)),
        JSON.stringify(view.feature?.elements.get(n.id)),
        view.hidden?.has(n.id),
      ];
      const prev = cache.get(n.id);
      const entry = prev && prev.key.every((k, i) => k === key[i]) ? prev : { key, node: toFlowNode(n, view, fk, marks) };
      next.set(n.id, entry);
      return entry.node;
    });
    cache = next;
    return nodes;
  };
}

export function toFlowEdges(doc: CanvasDoc, view: EdgeView): FlowEdge[] {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const pairs = edgePairs(doc.edges);
  return doc.edges.map((e) => toFlowEdge(e, view, nodes, pairs.get(e.id)));
}
