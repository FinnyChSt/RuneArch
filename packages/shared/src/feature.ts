import type { ApiModel } from './api';
import {
  featureItemKey,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type Feature,
  type FeatureItemRef,
  type FeatureRole,
} from './canvas';
import { elementIdOf } from './wireframe';

/*
 * Pure helpers for feature scopes (docs/feature-scopes-plan.md). Each returns a new doc (or the
 * same doc if nothing changed) and keeps it valid under CanvasDoc.parse.
 */

/** Frames, sketches and arrows are layout and notes, not parts of the system, so they are never tagged */
const isTaggableNode = (n: CanvasNode) => n.type !== 'frame' && n.type !== 'sketch';
const isTaggableEdge = (e: CanvasEdge) => e.kind !== 'arrow';

/** Deep equality where a missing key and an `undefined` value are the same */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((v, i) => sameValue(v, other[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!sameValue(ra[k], rb[k])) return false;
  return true;
}

/** What a node is, without where it sits: moving, resizing or reparenting a node doesn't change it */
const nodeContent = ({ position: _p, size: _s, parentId: _parent, ...rest }: CanvasNode) => rest;

/** What an edge does; which side it attaches to is layout, the screen element it starts at is not */
const edgeContent = ({ sourceHandle, targetHandle: _t, ...rest }: CanvasEdge) => ({
  ...rest,
  element: elementIdOf(sourceHandle),
});

export const sameNodeContent = (a: CanvasNode, b: CanvasNode) => sameValue(nodeContent(a), nodeContent(b));
export const sameEdgeContent = (a: CanvasEdge, b: CanvasEdge) => sameValue(edgeContent(a), edgeContent(b));

export const featureById = (doc: Pick<CanvasDoc, 'features'>, id: string) => doc.features.find((f) => f.id === id);

/** The role an item has in a feature, if it is in it */
export const roleOf = (feature: Feature, ref: FeatureItemRef): FeatureRole | undefined =>
  feature.items.find((i) => i.ref.kind === ref.kind && i.ref.id === ref.id)?.role;

const sameRef = (a: FeatureItemRef, b: FeatureItemRef) => a.kind === b.kind && a.id === b.id;

function withoutBaseline(feature: Feature, ref: FeatureItemRef): Feature['baseline'] {
  const { nodes, models } = feature.baseline;
  if (ref.kind === 'node' && ref.id in nodes) {
    const { [ref.id]: _, ...rest } = nodes;
    return { nodes: rest, models };
  }
  if (ref.kind === 'model' && ref.id in models) {
    const { [ref.id]: _, ...rest } = models;
    return { nodes, models: rest };
  }
  return feature.baseline;
}

/**
 * Puts an item into a feature with a role (or changes its role). An item `added` by another
 * feature moves here. A `changed` node or model keeps `original` as its baseline unless it already
 * has one; any other role drops the baseline.
 */
export function setFeatureItem(
  doc: CanvasDoc,
  featureId: string,
  ref: FeatureItemRef,
  role: FeatureRole,
  original?: CanvasNode | ApiModel,
): CanvasDoc {
  if (!featureById(doc, featureId)) return doc;
  const features = doc.features.map((f) => {
    if (f.id !== featureId) {
      // An item is added by one feature at most
      if (role !== 'added' || roleOf(f, ref) !== 'added') return f;
      return { ...f, items: f.items.filter((i) => !sameRef(i.ref, ref)) };
    }
    const existing = f.items.find((i) => sameRef(i.ref, ref));
    const items = existing
      ? f.items.map((i) => (i === existing ? { ...i, role } : i))
      : [...f.items, { ref, role }];
    let baseline = withoutBaseline(f, ref);
    if (role === 'changed') {
      const kept = ref.kind === 'node' ? f.baseline.nodes[ref.id] : ref.kind === 'model' ? f.baseline.models[ref.id] : undefined;
      if (kept) baseline = f.baseline;
      else if (original && ref.kind === 'node') baseline = { ...baseline, nodes: { ...baseline.nodes, [ref.id]: original as CanvasNode } };
      else if (original && ref.kind === 'model') baseline = { ...baseline, models: { ...baseline.models, [ref.id]: original as ApiModel } };
    }
    return { ...f, items, baseline };
  });
  return { ...doc, features };
}

/** Takes an item out of a feature, with its baseline */
export function removeFeatureItem(doc: CanvasDoc, featureId: string, ref: FeatureItemRef): CanvasDoc {
  const feature = featureById(doc, featureId);
  if (!feature || roleOf(feature, ref) === undefined) return doc;
  const next: Feature = {
    ...feature,
    items: feature.items.filter((i) => !sameRef(i.ref, ref)),
    baseline: withoutBaseline(feature, ref),
  };
  return { ...doc, features: doc.features.map((f) => (f.id === featureId ? next : f)) };
}

/** Drops feature items, baselines and flows whose node, edge, model or flow no longer exists */
export function pruneFeatures(doc: CanvasDoc): CanvasDoc {
  if (doc.features.length === 0) return doc;
  const exists = {
    node: new Set(doc.nodes.map((n) => n.id)),
    edge: new Set(doc.edges.map((e) => e.id)),
    model: new Set(doc.models.map((m) => m.id)),
  };
  const flows = new Set(doc.flows.map((f) => f.id));
  let changed = false;
  const features = doc.features.map((f) => {
    const items = f.items.filter((i) => exists[i.ref.kind].has(i.ref.id));
    const keep = new Set(items.map((i) => featureItemKey(i.ref)));
    const nodes = Object.entries(f.baseline.nodes).filter(([id]) => keep.has(featureItemKey({ kind: 'node', id })));
    const models = Object.entries(f.baseline.models).filter(([id]) => keep.has(featureItemKey({ kind: 'model', id })));
    const flowIds = f.flowIds.filter((id) => flows.has(id));
    if (
      items.length === f.items.length &&
      nodes.length === Object.keys(f.baseline.nodes).length &&
      models.length === Object.keys(f.baseline.models).length &&
      flowIds.length === f.flowIds.length
    )
      return f;
    changed = true;
    return { ...f, items, flowIds, baseline: { nodes: Object.fromEntries(nodes), models: Object.fromEntries(models) } };
  });
  return changed ? { ...doc, features } : doc;
}

/**
 * Tags what changed between two docs in the active feature: new nodes, edges and models are
 * `added`; edited ones become `changed`, keeping the version before the first edit as baseline.
 * Items the feature already adds, changes or removes keep their role. Moving or resizing a node is
 * not a change. Returns `next` (tagged) so the edit and its tags are one undo step.
 */
export function tagChanges(prev: CanvasDoc, next: CanvasDoc, featureId: string): CanvasDoc {
  if (prev === next || !featureById(next, featureId)) return next;
  type Change = { ref: FeatureItemRef; isNew: boolean; original?: CanvasNode | ApiModel };
  const changes: Change[] = [];

  if (prev.nodes !== next.nodes) {
    const before = new Map(prev.nodes.map((n) => [n.id, n]));
    for (const n of next.nodes) {
      const p = before.get(n.id);
      if (!isTaggableNode(n) || p === n) continue;
      const ref = { kind: 'node', id: n.id } as const;
      if (!p) changes.push({ ref, isNew: true });
      else if (!sameNodeContent(p, n)) changes.push({ ref, isNew: false, original: p });
    }
  }
  if (prev.edges !== next.edges) {
    const before = new Map(prev.edges.map((e) => [e.id, e]));
    for (const e of next.edges) {
      const p = before.get(e.id);
      if (!isTaggableEdge(e) || p === e) continue;
      const ref = { kind: 'edge', id: e.id } as const;
      if (!p) changes.push({ ref, isNew: true });
      else if (!sameEdgeContent(p, e)) changes.push({ ref, isNew: false });
    }
  }
  if (prev.models !== next.models) {
    const before = new Map(prev.models.map((m) => [m.id, m]));
    for (const m of next.models) {
      const p = before.get(m.id);
      if (p === m) continue;
      const ref = { kind: 'model', id: m.id } as const;
      if (!p) changes.push({ ref, isNew: true });
      else if (!sameValue(p, m)) changes.push({ ref, isNew: false, original: p });
    }
  }

  let doc = next;
  for (const { ref, isNew, original } of changes) {
    if (isNew) {
      doc = setFeatureItem(doc, featureId, ref, 'added');
      continue;
    }
    const role = roleOf(featureById(doc, featureId)!, ref);
    if (role === undefined || role === 'uses') doc = setFeatureItem(doc, featureId, ref, 'changed', original);
  }
  return doc;
}
