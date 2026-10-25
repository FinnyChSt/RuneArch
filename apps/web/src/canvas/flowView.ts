import { elementIdOf, type CanvasDoc, type CanvasNode } from '@flowcanvas/shared';
import { flowColorVar } from './flowColors';

/** What the canvas needs to highlight the active flow */
export type FlowView = {
  flowId: string;
  /** CSS color of the flow */
  color: string;
  /** Nodes the flow passes through */
  nodeIds: ReadonlySet<string>;
  /** Edge id -> 1-based step number */
  edgeSteps: ReadonlyMap<string, number>;
  /** Edge of the step at the playhead */
  currentEdgeId: string | null;
  /** Screen id -> element id -> number of the first step that starts at that element */
  elementSteps: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Element the step at the playhead starts from, if any */
  currentElement: { nodeId: string; elementId: string } | null;
  recording: boolean;
  /** While recording: edges that can be appended next */
  candidateEdgeIds: ReadonlySet<string>;
};

export function flowView(
  doc: CanvasDoc,
  flowId: string | null,
  options: { playhead?: number | null; recording?: boolean } = {},
): FlowView | null {
  const flow = flowId ? doc.flows.find((f) => f.id === flowId) : undefined;
  if (!flow) return null;

  const edges = new Map(doc.edges.map((e) => [e.id, e]));
  const nodeIds = new Set<string>();
  const edgeSteps = new Map<string, number>();
  const elementSteps = new Map<string, Map<string, number>>();
  flow.steps.forEach((step, i) => {
    const edge = edges.get(step.edgeId);
    if (!edge) return;
    edgeSteps.set(edge.id, i + 1);
    nodeIds.add(edge.source).add(edge.target);
    const elementId = elementIdOf(edge.sourceHandle);
    if (elementId === null) return;
    const steps = elementSteps.get(edge.source) ?? new Map<string, number>();
    if (!steps.has(elementId)) steps.set(elementId, i + 1);
    elementSteps.set(edge.source, steps);
  });

  const recording = options.recording ?? false;
  // Same rule as canAppendStep: unused edges leaving a reached node (any edge for the first step)
  const candidateEdgeIds = new Set(
    recording
      ? doc.edges.filter((e) => !edgeSteps.has(e.id) && (nodeIds.size === 0 || nodeIds.has(e.source))).map((e) => e.id)
      : [],
  );

  const playhead = options.playhead ?? null;
  const currentEdgeId = playhead === null ? null : (flow.steps[playhead]?.edgeId ?? null);
  const currentEdge = currentEdgeId ? edges.get(currentEdgeId) : undefined;
  const currentElementId = elementIdOf(currentEdge?.sourceHandle);
  return {
    flowId: flow.id,
    color: flowColorVar(flow.color),
    nodeIds,
    edgeSteps,
    currentEdgeId,
    elementSteps,
    currentElement: currentEdge && currentElementId !== null ? { nodeId: currentEdge.source, elementId: currentElementId } : null,
    recording,
    candidateEdgeIds,
  };
}

/** Short human name for a node, e.g. in flow step lists */
export function nodeTitle(node: CanvasNode | undefined): string {
  if (!node) return '?';
  if (node.type === 'endpoint') return `${node.data.method} ${node.data.path}`;
  return node.label || node.type;
}

/** Where an edge starts: the node, plus the wireframe element for element links ("Cart · Place order") */
export function sourceTitle(node: CanvasNode | undefined, sourceHandle: string | undefined): string {
  const elementId = elementIdOf(sourceHandle);
  const element =
    elementId !== null && node?.type === 'screen' ? node.data.wireframe?.elements.find((el) => el.id === elementId) : undefined;
  return element ? `${nodeTitle(node)} · ${element.text?.trim() || element.kind}` : nodeTitle(node);
}
