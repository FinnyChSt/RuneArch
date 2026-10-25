import { modelRefOf, type ApiModel } from './api';
import {
  checkFlowSteps,
  featureItemKey,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type FeatureItemRef,
  type FeatureRole,
} from './canvas';
import { featureById, pruneFeatures } from './feature';
import { changedFields, diffNode } from './feature-diff';

/*
 * What an export covers: one feature (its items plus the context they need), or the whole
 * project, optionally without what unshipped features add (docs/feature-scopes-plan.md §5).
 */

/** `featureItemKey(ref)` -> role; context items a feature needs but doesn't list count as `uses` */
export type FeatureRoles = ReadonlyMap<string, FeatureRole>;

export type ExportScope = {
  /** Only this feature's items (and the context they need), with their roles */
  featureId?: string;
  /** Whole project only: `exclude` leaves out what unshipped features add */
  unshipped?: 'include' | 'exclude';
};

export type ScopedDoc = { doc: CanvasDoc; roles?: FeatureRoles; featureName?: string };

/** Models the given nodes and models refer to, followed through nested model references */
export function referencedModels(nodes: readonly CanvasNode[], models: readonly ApiModel[], seed: Iterable<string> = []): Set<string> {
  const byId = new Map(models.map((m) => [m.id, m]));
  const found = new Set<string>();
  const queue: string[] = [...seed];
  const add = (id: string | undefined) => id && queue.push(id);
  for (const n of nodes) {
    if (n.type === 'endpoint') {
      if (n.data.spec.requestBody) add(modelRefOf(n.data.spec.requestBody.type));
      n.data.spec.responses.forEach((r) => r.body && add(modelRefOf(r.body)));
    }
    if (n.type === 'screen' || n.type === 'component') n.data.wireframe?.elements.forEach((el) => add(el.modelRef));
  }
  while (queue.length) {
    const id = queue.pop()!;
    if (found.has(id) || !byId.has(id)) continue;
    found.add(id);
    byId.get(id)!.fields.forEach((f) => add(modelRefOf(f.type)));
  }
  return found;
}

/** Components placed on the given screens */
export const placedComponents = (nodes: readonly CanvasNode[]) =>
  new Set(
    nodes.flatMap((n) => (n.type === 'screen' ? (n.data.wireframe?.elements.flatMap((el) => (el.componentId ? [el.componentId] : [])) ?? []) : [])),
  );

/** Keeps the steps that still continue the flow once edges are gone */
export function pruneSteps(doc: CanvasDoc, edges: readonly CanvasEdge[]): CanvasDoc['flows'] {
  const byId = new Map(edges.map((e) => [e.id, e]));
  return doc.flows.map((f) => {
    const kept: typeof f.steps = [];
    for (const step of f.steps) if (!checkFlowSteps(byId, [...kept, step]).at(-1)) kept.push(step);
    return kept.length === f.steps.length ? f : { ...f, steps: kept };
  });
}

/**
 * A feature's part of the doc: its nodes, edges and models in every role, plus the context they
 * need to stay a valid document (both ends of its edges, tables its tables reference, components
 * its screens place, models its endpoints and models use, and enclosing frames). Context items
 * count as `uses`. Edges between included nodes come along; flows are the feature's own, cut to
 * the included edges.
 */
export function scopeToFeature(doc: CanvasDoc, featureId: string): ScopedDoc | null {
  const feature = featureById(doc, featureId);
  if (!feature) return null;
  const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
  const roles = new Map<string, FeatureRole>(feature.items.map((i) => [featureItemKey(i.ref), i.role]));
  const context = (ref: FeatureItemRef) => {
    const key = featureItemKey(ref);
    if (!roles.has(key)) roles.set(key, 'uses');
  };

  const nodeIds = new Set(feature.items.filter((i) => i.ref.kind === 'node').map((i) => i.ref.id));
  for (const item of feature.items) {
    if (item.ref.kind !== 'edge') continue;
    const edge = doc.edges.find((e) => e.id === item.ref.id);
    for (const end of edge ? [edge.source, edge.target] : []) nodeIds.add(end);
  }
  for (const e of doc.edges) if (e.kind === 'fk' && nodeIds.has(e.source)) nodeIds.add(e.target);
  for (const id of placedComponents(doc.nodes.filter((n) => nodeIds.has(n.id)))) nodeIds.add(id);
  for (const id of nodeIds) if (nodesById.get(id)?.type !== 'frame') context({ kind: 'node', id });
  // Enclosing frames keep child positions right; they are layout, not feature items
  for (const id of [...nodeIds]) {
    const parent = nodesById.get(id)?.parentId;
    if (parent) nodeIds.add(parent);
  }

  const nodes = doc.nodes.filter((n) => nodeIds.has(n.id));
  const edges = doc.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  for (const e of edges) context({ kind: 'edge', id: e.id });
  const modelIds = referencedModels(
    nodes,
    doc.models,
    feature.items.filter((i) => i.ref.kind === 'model').map((i) => i.ref.id),
  );
  for (const id of modelIds) context({ kind: 'model', id });
  const models = doc.models.filter((m) => modelIds.has(m.id));
  const flowIds = new Set(feature.flowIds);
  const scoped: CanvasDoc = { ...doc, nodes, edges, models, flows: [], features: [feature] };
  const flows = pruneSteps({ ...doc, flows: doc.flows.filter((f) => flowIds.has(f.id)) }, edges);
  return { doc: pruneFeatures({ ...scoped, flows }), roles, featureName: feature.name };
}

/**
 * The project without what unshipped features add: their added nodes and edges (and edges
 * touching those nodes), and their added models unless something kept still refers to them.
 * Changed items keep their current version, like "hide unshipped" on the canvas.
 */
export function withoutUnshipped(doc: CanvasDoc): CanvasDoc {
  const drop = { node: new Set<string>(), edge: new Set<string>(), model: new Set<string>() };
  for (const f of doc.features) {
    if (f.status === 'shipped') continue;
    for (const i of f.items) if (i.role === 'added') drop[i.ref.kind].add(i.ref.id);
  }
  if (drop.node.size + drop.edge.size + drop.model.size === 0) return doc;

  // Components still placed on a kept screen stay
  let nodes = doc.nodes.filter((n) => !drop.node.has(n.id));
  const placed = placedComponents(nodes);
  nodes = doc.nodes.filter((n) => !drop.node.has(n.id) || placed.has(n.id));
  const kept = new Set(nodes.map((n) => n.id));
  // Children of a dropped frame stay where they are
  nodes = nodes.map((n) => {
    if (!n.parentId || kept.has(n.parentId)) return n;
    const parent = doc.nodes.find((p) => p.id === n.parentId)!;
    return { ...n, parentId: undefined, position: { x: parent.position.x + n.position.x, y: parent.position.y + n.position.y } };
  });
  const edges = doc.edges.filter((e) => !drop.edge.has(e.id) && kept.has(e.source) && kept.has(e.target));
  const keptModels = doc.models.filter((m) => !drop.model.has(m.id));
  const needed = referencedModels(nodes, doc.models, keptModels.map((m) => m.id));
  const models = doc.models.filter((m) => !drop.model.has(m.id) || needed.has(m.id));
  return pruneFeatures({ ...doc, nodes, edges, models, flows: pruneSteps(doc, edges) });
}

/** The doc an export renders; null for an unknown feature */
export function applyScope(doc: CanvasDoc, scope: ExportScope = {}): ScopedDoc | null {
  if (scope.featureId) return scopeToFeature(doc, scope.featureId);
  return { doc: scope.unshipped === 'exclude' ? withoutUnshipped(doc) : doc };
}

export type FeatureDependency = {
  featureId: string;
  name: string;
  /** Items this feature uses or changes that the other (unshipped) feature adds */
  items: FeatureItemRef[];
};

/** Unshipped features that add something this feature uses, changes or removes */
export function featureDependencies(doc: CanvasDoc, featureId: string): FeatureDependency[] {
  const feature = featureById(doc, featureId);
  if (!feature) return [];
  const mine = new Map(feature.items.filter((i) => i.role !== 'added').map((i) => [featureItemKey(i.ref), i.ref]));
  return doc.features.flatMap((other) => {
    if (other.id === featureId || other.status === 'shipped') return [];
    const items = other.items.filter((i) => i.role === 'added' && mine.has(featureItemKey(i.ref))).map((i) => i.ref);
    return items.length ? [{ featureId: other.id, name: other.name, items }] : [];
  });
}

/** What exports mark per table: its role, and per column whether the feature adds or changes it */
export type FeatureAnnotations = {
  featureName: string;
  roles: FeatureRoles;
  /** Table id -> column id -> "new" or "changed: type text → citext" */
  columns: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Table id -> names of the columns the feature drops */
  dropped: ReadonlyMap<string, readonly string[]>;
};

/** Annotations for a scoped feature doc; null for an unknown feature */
export function featureAnnotations(doc: CanvasDoc, featureId: string): FeatureAnnotations | null {
  const scoped = scopeToFeature(doc, featureId);
  const feature = featureById(doc, featureId);
  if (!scoped || !feature) return null;
  const columns = new Map<string, Map<string, string>>();
  const dropped = new Map<string, string[]>();
  for (const n of doc.nodes) {
    const baseline = feature.baseline.nodes[n.id];
    if (n.type !== 'table' || baseline?.type !== 'table') continue;
    const notes = new Map<string, string>();
    for (const e of diffNode(baseline, n)) {
      if (e.type === 'prop' || e.label !== 'Column') continue;
      if (e.type === 'added') notes.set(e.key, 'new');
      else if (e.type === 'changed') notes.set(e.key, `changed: ${changedFields(e)}`);
      else dropped.set(n.id, [...(dropped.get(n.id) ?? []), e.name]);
    }
    columns.set(n.id, notes);
  }
  return { featureName: feature.name, roles: scoped.roles!, columns, dropped };
}

/** "new in Wishlist", "changed by Wishlist", "existing", "removed by Wishlist" */
export function roleText(role: FeatureRole | undefined, featureName: string): string {
  switch (role) {
    case 'added':
      return `new in ${featureName}`;
    case 'changed':
      return `changed by ${featureName}`;
    case 'removed':
      return `removed by ${featureName}`;
    default:
      return 'existing';
  }
}

/**
 * The project as it was before a feature: what it adds is gone, what it changes is back to its
 * baseline (in its current place), what it removes is still there. Edges that no longer fit (FKs on
 * columns the baseline doesn't have, links from elements it doesn't have) are dropped; added models
 * and components that kept parts still use stay. Null for an unknown feature.
 */
export function beforeFeature(doc: CanvasDoc, featureId: string): CanvasDoc | null {
  const feature = featureById(doc, featureId);
  if (!feature) return null;
  const added = new Set(feature.items.filter((i) => i.role === 'added').map((i) => featureItemKey(i.ref)));
  let nodes = doc.nodes
    .filter((n) => !added.has(`node:${n.id}`))
    .map((n) => {
      const base = feature.baseline.nodes[n.id];
      return base ? ({ ...base, position: n.position, size: n.size, parentId: n.parentId } as CanvasNode) : n;
    });
  // Added components still placed on a kept screen stay, like added models still in use (below)
  const placed = placedComponents(nodes);
  nodes = [...nodes, ...doc.nodes.filter((n) => added.has(`node:${n.id}`) && placed.has(n.id))];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fits = (e: CanvasEdge) => {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t || added.has(`edge:${e.id}`)) return false;
    if (e.kind === 'fk')
      return (
        s.type === 'table' && t.type === 'table' &&
        s.data.columns.some((c) => c.id === e.data.sourceColumnId) &&
        t.data.columns.some((c) => c.id === e.data.targetColumnId)
      );
    const element = e.sourceHandle?.startsWith('el:') ? e.sourceHandle.slice(3) : null;
    return element === null || (s.type === 'screen' && !!s.data.wireframe?.elements.some((el) => el.id === element));
  };
  const edges = doc.edges.filter(fits);
  const keptModels = doc.models.filter((m) => !added.has(`model:${m.id}`)).map((m) => feature.baseline.models[m.id] ?? m);
  const needed = referencedModels(nodes, doc.models.map((m) => feature.baseline.models[m.id] ?? m), keptModels.map((m) => m.id));
  const models = doc.models.filter((m) => !added.has(`model:${m.id}`) || needed.has(m.id)).map((m) => feature.baseline.models[m.id] ?? m);
  return pruneFeatures({ ...doc, nodes, edges, models, flows: pruneSteps(doc, edges) });
}
