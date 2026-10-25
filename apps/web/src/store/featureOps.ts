import {
  CanvasDoc,
  diffModel,
  diffNode,
  elementIdOf,
  featureById,
  isInteractive,
  revertEntry,
  setFeatureItem,
  type ApiModel,
  type CanvasNode,
  type DiffEntry,
  type FeatureItemRef,
} from '@flowcanvas/shared';
import { removeElements, replaceNode, upsertModel } from './docOps';

export type RevertResult = { ok: true; doc: CanvasDoc } | { ok: false; reason: string };

/** Edges a node no longer supports: FKs on columns it lost, links from screen elements it lost */
function staleEdges(doc: CanvasDoc, node: CanvasNode): string[] {
  const columns = node.type === 'table' ? new Set(node.data.columns.map((c) => c.id)) : null;
  const elements =
    node.type === 'screen'
      ? new Set(node.data.wireframe?.elements.filter((el) => isInteractive(el.kind)).map((el) => el.id))
      : null;
  return doc.edges
    .filter((e) => {
      if (e.kind === 'fk' && columns)
        return (e.source === node.id && !columns.has(e.data.sourceColumnId)) || (e.target === node.id && !columns.has(e.data.targetColumnId));
      const elementId = e.source === node.id ? elementIdOf(e.sourceHandle) : null;
      return elementId !== null && elements !== null && !elements.has(elementId);
    })
    .map((e) => e.id);
}

/**
 * Puts a reverted node or model into the doc, drops the edges it no longer supports, and marks it
 * `uses` once nothing differs from the baseline any more. Fails (doc unchanged) when the result
 * isn't valid, e.g. a field pointing at a model that was deleted since.
 */
function applyReverted(doc: CanvasDoc, featureId: string, ref: FeatureItemRef, next: CanvasNode | ApiModel): RevertResult {
  const feature = featureById(doc, featureId)!;
  let out: CanvasDoc;
  let unchanged: boolean;
  if (ref.kind === 'node') {
    const node = next as CanvasNode;
    out = replaceNode(doc, node);
    out = removeElements(out, staleEdges(out, node));
    unchanged = diffNode(feature.baseline.nodes[ref.id]!, node).length === 0;
  } else {
    out = upsertModel(doc, next as ApiModel);
    unchanged = diffModel(feature.baseline.models[ref.id]!, next as ApiModel).length === 0;
  }
  if (unchanged && featureById(out, featureId)) out = setFeatureItem(out, featureId, ref, 'uses');
  const parsed = CanvasDoc.safeParse(out);
  return parsed.success
    ? { ok: true, doc: out }
    : { ok: false, reason: `Can't revert: ${parsed.error.issues[0]?.message ?? 'the result is not valid'}` };
}

const baselineOf = (doc: CanvasDoc, featureId: string, ref: FeatureItemRef) => {
  const feature = featureById(doc, featureId);
  if (!feature) return undefined;
  if (ref.kind === 'node') {
    const current = doc.nodes.find((n) => n.id === ref.id);
    const baseline = feature.baseline.nodes[ref.id];
    return current && baseline ? { current, baseline } : undefined;
  }
  if (ref.kind === 'model') {
    const current = doc.models.find((m) => m.id === ref.id);
    const baseline = feature.baseline.models[ref.id];
    return current && baseline ? { current, baseline } : undefined;
  }
  return undefined;
};

/** Undoes one change of a changed item (a column, a param, its label, ...) from the feature's baseline */
export function revertFeatureEntry(doc: CanvasDoc, featureId: string, ref: FeatureItemRef, entry: DiffEntry): RevertResult {
  const pair = baselineOf(doc, featureId, ref);
  if (!pair) return { ok: false, reason: 'Nothing to revert: the item has no baseline' };
  return applyReverted(doc, featureId, ref, revertEntry(pair.current, pair.baseline, entry));
}

/** Puts a changed item back as it was before the feature; a node keeps its place on the canvas */
export function revertFeatureItem(doc: CanvasDoc, featureId: string, ref: FeatureItemRef): RevertResult {
  const pair = baselineOf(doc, featureId, ref);
  if (!pair) return { ok: false, reason: 'Nothing to revert: the item has no baseline' };
  const next =
    ref.kind === 'node'
      ? ({
          ...(pair.baseline as CanvasNode),
          position: (pair.current as CanvasNode).position,
          size: (pair.current as CanvasNode).size,
          parentId: (pair.current as CanvasNode).parentId,
        } as CanvasNode)
      : pair.baseline;
  return applyReverted(doc, featureId, ref, next);
}
