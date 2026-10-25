import {
  diffModel,
  diffNode,
  featureById,
  featureItemKey,
  type CanvasDoc,
  type Column,
  type DiffEntry,
  type Feature,
  type FeatureItemRef,
  type FeatureRole,
  type TableNode,
} from '@flowcanvas/shared';
import { edgeCaption } from './edgeText';
import { FLOW_COLORS, flowColorVar, type FlowColor } from './flowColors';
import { nodeTitle, sourceTitle } from './flowView';

/** How a table's columns differ from the feature's baseline copy of it */
export type ColumnMarks = {
  /** Column id -> added or changed since the baseline */
  marks: Readonly<Record<string, 'added' | 'changed'>>;
  /** Baseline columns the table no longer has */
  dropped: readonly Pick<Column, 'id' | 'name' | 'type'>[];
};

/** What the canvas needs to show the highlighted feature */
export type FeatureView = {
  featureId: string;
  /** CSS color of the feature */
  color: string;
  /** `node:<id>` / `edge:<id>` / `model:<id>` -> role */
  roles: ReadonlyMap<string, FeatureRole>;
  /** Changed tables: column markers */
  columns: ReadonlyMap<string, ColumnMarks>;
  /** Changed screens: element id -> added or changed */
  elements: ReadonlyMap<string, Readonly<Record<string, Mark>>>;
  /** Changed models: field id -> added or changed */
  fields: ReadonlyMap<string, Readonly<Record<string, Mark>>>;
};

type Mark = 'added' | 'changed';

/** Markers for one list of a diff (columns, elements, fields): added and changed items by key, and removed items */
export function listMarks(entries: readonly DiffEntry[], label: string): { marks: Record<string, Mark>; removed: unknown[] } {
  const marks: Record<string, Mark> = {};
  const removed: unknown[] = [];
  for (const e of entries) {
    if (e.type === 'prop' || e.label !== label) continue;
    if (e.type === 'removed') removed.push(e.before);
    else marks[e.key] = e.type;
  }
  return { marks, removed };
}

/** Column markers of a table against its baseline (by column id, so renames count as changes) */
export function columnMarks(baseline: TableNode, current: TableNode): ColumnMarks {
  const { marks, removed } = listMarks(diffNode(baseline, current), 'Column');
  const dropped = (removed as Column[]).map(({ id, name, type }) => ({ id, name, type }));
  return { marks, dropped };
}

export function featureView(doc: CanvasDoc, featureId: string | null): FeatureView | null {
  const feature = featureId ? featureById(doc, featureId) : undefined;
  if (!feature) return null;
  const roles = new Map(feature.items.map((i) => [featureItemKey(i.ref), i.role]));
  const columns = new Map<string, ColumnMarks>();
  const elements = new Map<string, Readonly<Record<string, Mark>>>();
  for (const n of doc.nodes) {
    const baseline = feature.baseline.nodes[n.id];
    if (!baseline) continue;
    if (n.type === 'table' && baseline.type === 'table') columns.set(n.id, columnMarks(baseline, n));
    if (n.type === 'screen') {
      const { marks } = listMarks(diffNode(baseline, n), 'Element');
      if (Object.keys(marks).length) elements.set(n.id, marks);
    }
  }
  const fields = new Map<string, Readonly<Record<string, Mark>>>();
  for (const m of doc.models) {
    const baseline = feature.baseline.models[m.id];
    if (baseline) fields.set(m.id, listMarks(diffModel(baseline, m), 'Field').marks);
  }
  return { featureId: feature.id, color: flowColorVar(feature.color), roles, columns, elements, fields };
}

/** Role of a node or edge in the view, if it is in the feature */
export const roleIn = (view: FeatureView | null | undefined, ref: FeatureItemRef) =>
  view?.roles.get(featureItemKey(ref));

/**
 * Nodes and edges that unshipped features add, for "hide unshipped". The features named in
 * `keep` (the highlighted one and the one being worked on) stay visible.
 */
export function unshippedIds(doc: CanvasDoc, keep: readonly (string | null)[] = []): Set<string> {
  const ids = new Set<string>();
  for (const f of doc.features) {
    if (f.status === 'shipped' || keep.includes(f.id)) continue;
    for (const i of f.items) if (i.role === 'added' && i.ref.kind !== 'model') ids.add(i.ref.id);
  }
  return ids;
}

/** Items of a feature per role, for counts and lists */
export function itemsByRole(feature: Feature): Record<FeatureRole, Feature['items']> {
  const groups: Record<FeatureRole, Feature['items']> = { added: [], changed: [], removed: [], uses: [] };
  for (const item of feature.items) groups[item.role].push(item);
  return groups;
}

/** First palette color no feature uses yet (cycles when all are taken) */
export function nextFeatureColor(doc: CanvasDoc): FlowColor {
  const used = new Set(doc.features.map((f) => f.color));
  return FLOW_COLORS.find((c) => !used.has(c)) ?? FLOW_COLORS[doc.features.length % FLOW_COLORS.length]!;
}

export const STATUS_LABEL: Record<Feature['status'], string> = {
  draft: 'Draft',
  'in-progress': 'In progress',
  shipped: 'Shipped',
};

/** Badge text per role, as on the canvas */
export const ROLE_LABEL: Record<FeatureRole, string> = {
  added: 'New',
  changed: 'Changed',
  removed: 'Removed',
  uses: 'Existing',
};

/** Short name of a feature item: "users", "POST /orders", "Cart → POST /orders · calls", "OrderDto" */
export function itemTitle(doc: CanvasDoc, ref: FeatureItemRef): string {
  if (ref.kind === 'model') return doc.models.find((m) => m.id === ref.id)?.name ?? '?';
  const node = (id: string) => doc.nodes.find((n) => n.id === id);
  if (ref.kind === 'node') return nodeTitle(node(ref.id));
  const edge = doc.edges.find((e) => e.id === ref.id);
  if (!edge) return '?';
  return `${sourceTitle(node(edge.source), edge.sourceHandle)} → ${nodeTitle(node(edge.target))} · ${edgeCaption(edge)}`;
}
