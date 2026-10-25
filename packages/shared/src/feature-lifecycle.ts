import {
  CanvasDoc,
  featureItemKey,
  type CanvasNode,
  type FeatureItemRef,
} from './canvas';
import { featureById, pruneFeatures } from './feature';
import { beforeFeature, featureDependencies, pruneSteps, referencedModels } from './feature-scope';

/*
 * The end of a feature (docs/feature-scopes-plan.md §6): ship it (its work becomes the plain
 * project) or discard it (the project goes back to how it was before). Nothing here blocks:
 * unshipped dependencies and parts still in use are warnings. Only a result that isn't a valid
 * document is refused, since it couldn't be saved.
 */

export type LifecycleResult = { ok: true; doc: CanvasDoc; warnings: string[] } | { ok: false; reason: string };

const nodeName = (n: CanvasNode | undefined) => (!n ? '?' : n.type === 'endpoint' ? `${n.data.method} ${n.data.path}` : n.label || n.type);

function valid(doc: CanvasDoc, warnings: string[]): LifecycleResult {
  const parsed = CanvasDoc.safeParse(doc);
  return parsed.success
    ? { ok: true, doc, warnings }
    : { ok: false, reason: parsed.error.issues[0]?.message ?? 'The result is not a valid document' };
}

/**
 * Deletes nodes, edges and models for good: edges touching deleted nodes go too, children of a
 * deleted frame keep their place, component instances of deleted components leave their screens,
 * flow steps are cut, and models something kept still uses stay (named in `kept`).
 */
function removeParts(doc: CanvasDoc, refs: readonly FeatureItemRef[]): { doc: CanvasDoc; kept: string[] } {
  const ids = { node: new Set<string>(), edge: new Set<string>(), model: new Set<string>() };
  for (const r of refs) ids[r.kind].add(r.id);
  const removed = (id: string) => ids.node.has(id);
  const nodes = doc.nodes
    .filter((n) => !removed(n.id))
    .map((n): CanvasNode => {
      let next = n;
      if (n.parentId && removed(n.parentId)) {
        const parent = doc.nodes.find((p) => p.id === n.parentId)!;
        next = { ...next, parentId: undefined, position: { x: parent.position.x + n.position.x, y: parent.position.y + n.position.y } };
      }
      const wf = next.type === 'screen' ? next.data.wireframe : undefined;
      if (next.type === 'screen' && wf?.elements.some((el) => el.componentId && removed(el.componentId))) {
        const elements = wf.elements.filter((el) => !(el.componentId && removed(el.componentId)));
        next = { ...next, data: { ...next.data, wireframe: { ...wf, elements } } };
      }
      return next;
    });
  const edges = doc.edges.filter((e) => !ids.edge.has(e.id) && !removed(e.source) && !removed(e.target));
  const remaining = doc.models.filter((m) => !ids.model.has(m.id));
  const needed = referencedModels(nodes, doc.models, remaining.map((m) => m.id));
  const kept = doc.models.filter((m) => ids.model.has(m.id) && needed.has(m.id)).map((m) => m.name);
  const models = doc.models.filter((m) => !ids.model.has(m.id) || needed.has(m.id));
  return { doc: pruneFeatures({ ...doc, nodes, edges, models, flows: pruneSteps(doc, edges) }), kept };
}

/**
 * Ships a feature: what it removes is deleted for good, what it adds and changes is simply the
 * project now (its baselines are dropped), and its status becomes `shipped`. Warns about unshipped
 * features it depends on and about removed models something still uses (they stay).
 */
export function shipFeature(doc: CanvasDoc, featureId: string): LifecycleResult {
  const feature = featureById(doc, featureId);
  if (!feature) return { ok: false, reason: 'Unknown feature' };
  const warnings = featureDependencies(doc, featureId).map(
    (d) => `${d.name} is not shipped yet, and ${feature.name} relies on what it adds (${d.items.length} item${d.items.length === 1 ? '' : 's'})`,
  );
  const removedRefs = feature.items.filter((i) => i.role === 'removed').map((i) => i.ref);
  const { doc: removed, kept } = removeParts(doc, removedRefs);
  warnings.push(...kept.map((name) => `${name} stays: something still uses it`));
  const features = removed.features.map((f) =>
    f.id === featureId ? { ...f, status: 'shipped' as const, baseline: { nodes: {}, models: {} } } : f,
  );
  return valid({ ...removed, features }, warnings);
}

/**
 * Discards a feature: what it adds is deleted, what it changes goes back to its baseline, its
 * removal marks are dropped (those parts stay), and the feature itself is deleted. A shipped
 * feature's work is the plain project, so it can't be discarded (delete the feature instead).
 */
export function discardFeature(doc: CanvasDoc, featureId: string): LifecycleResult {
  if (featureById(doc, featureId)?.status === 'shipped')
    return { ok: false, reason: 'It is shipped, so its work is part of the project; delete the feature to forget it' };
  const before = beforeFeature(doc, featureId);
  if (!before) return { ok: false, reason: 'Unknown feature' };
  return valid(pruneFeatures({ ...before, features: before.features.filter((f) => f.id !== featureId) }), []);
}

export type FeatureConflict = {
  featureId: string;
  name: string;
  /** Parts both features change or remove */
  items: FeatureItemRef[];
};

/** Other unshipped features that also change or remove a part this feature changes or removes */
export function featureConflicts(doc: CanvasDoc, featureId: string): FeatureConflict[] {
  const feature = featureById(doc, featureId);
  if (!feature) return [];
  const touches = (role: string) => role === 'changed' || role === 'removed';
  const mine = new Set(feature.items.filter((i) => i.ref.kind !== 'edge' && touches(i.role)).map((i) => featureItemKey(i.ref)));
  return doc.features.flatMap((other) => {
    if (other.id === featureId || other.status === 'shipped') return [];
    const items = other.items.filter((i) => touches(i.role) && mine.has(featureItemKey(i.ref))).map((i) => i.ref);
    return items.length ? [{ featureId: other.id, name: other.name, items }] : [];
  });
}

/** "users", "GET /orders", "OrderDto", "POST /orders → orders" */
export function partName(doc: CanvasDoc, ref: FeatureItemRef): string {
  if (ref.kind === 'model') return doc.models.find((m) => m.id === ref.id)?.name ?? '?';
  const node = (id: string) => doc.nodes.find((n) => n.id === id);
  if (ref.kind === 'node') return nodeName(node(ref.id));
  const edge = doc.edges.find((e) => e.id === ref.id);
  return edge ? `${nodeName(node(edge.source))} → ${nodeName(node(edge.target))}` : '?';
}
