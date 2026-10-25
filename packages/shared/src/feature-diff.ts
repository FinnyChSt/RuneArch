import type { ApiModel } from './api';
import type { CanvasNode, NodeType } from './canvas';
import { sameValue } from './feature';

/*
 * What a feature changed on a node or model: its baseline copy against the current version.
 * Each difference is one `DiffEntry` (a property, or an item of a list matched by id, status or
 * value), so the panel, the dialogs, revert and the exports all read the same data.
 */

export type DiffPath = readonly string[];

export type DiffEntry =
  /** A single value: label, route, method, ... */
  | { type: 'prop'; path: DiffPath; label: string; before: unknown; after: unknown }
  /** An item of a list (a column, a param, an element, a service method, ...) */
  | {
      type: 'added' | 'removed' | 'changed';
      path: DiffPath;
      /** What the list holds, singular: "Column", "Param", ... */
      label: string;
      key: string;
      /** The item's name, after the change (before it, for removed items) */
      name: string;
      before?: unknown;
      after?: unknown;
      /** Changed items: the fields that differ */
      fields?: string[];
    };

type Item = Record<string, unknown>;

type ListSpec = {
  path: DiffPath;
  label: string;
  key(item: unknown): string;
  name(item: unknown): string;
  /** Fields that are layout, not content (e.g. an element's grid rect) */
  ignore?: readonly string[];
};

type PropSpec = {
  path: DiffPath;
  label: string;
  /** Only whether it is there counts; its contents are diffed as lists (e.g. a wireframe) */
  presence?: boolean;
};

type DiffSpec = { props: readonly PropSpec[]; lists: readonly ListSpec[] };

const byId = (label: string, path: DiffPath, name: (item: Item) => string, ignore?: string[]): ListSpec => ({
  path,
  label,
  key: (item) => String((item as Item).id),
  name: (item) => name(item as Item),
  ignore,
});

const strings = (label: string, path: DiffPath): ListSpec => ({
  path,
  label,
  key: (item) => String(item),
  name: (item) => String(item),
});

const COMMON: PropSpec[] = [
  { path: ['label'], label: 'Name' },
  { path: ['notes'], label: 'Notes' },
];

const elementName = (el: Item) => (typeof el.text === 'string' && el.text.trim()) || String(el.kind);

const WIREFRAME: Pick<DiffSpec, 'props'> & { lists: ListSpec[] } = {
  props: [
    { path: ['data', 'wireframe'], label: 'Wireframe', presence: true },
    { path: ['data', 'wireframe', 'device'], label: 'Device' },
  ],
  lists: [byId('Element', ['data', 'wireframe', 'elements'], elementName, ['rect'])],
};

/** What is compared per node type; layout (position, size, frame) never counts */
const NODE_SPECS: Record<NodeType, DiffSpec> = {
  table: {
    props: [...COMMON, { path: ['data', 'schema'], label: 'Schema' }],
    lists: [
      byId('Column', ['data', 'columns'], (c) => String(c.name)),
      byId('Index', ['data', 'indexes'], (ix) => (typeof ix.name === 'string' && ix.name) || 'index'),
    ],
  },
  endpoint: {
    props: [
      ...COMMON,
      { path: ['data', 'method'], label: 'Method' },
      { path: ['data', 'path'], label: 'Path' },
      { path: ['data', 'auth'], label: 'Auth' },
      { path: ['data', 'spec', 'summary'], label: 'Summary' },
      { path: ['data', 'spec', 'description'], label: 'Description' },
      { path: ['data', 'spec', 'operationId'], label: 'Operation id' },
      { path: ['data', 'spec', 'deprecated'], label: 'Deprecated' },
      { path: ['data', 'spec', 'requestBody'], label: 'Request body' },
    ],
    lists: [
      strings('Tag', ['data', 'spec', 'tags']),
      byId('Param', ['data', 'spec', 'params'], (p) => `${String(p.in)} ${String(p.name)}`),
      {
        path: ['data', 'spec', 'responses'],
        label: 'Response',
        key: (r) => String((r as Item).status),
        name: (r) => String((r as Item).status),
      },
    ],
  },
  screen: {
    props: [...COMMON, { path: ['data', 'route'], label: 'Route' }, ...WIREFRAME.props],
    lists: [strings('State', ['data', 'state']), ...WIREFRAME.lists],
  },
  component: {
    props: [...COMMON, ...WIREFRAME.props],
    lists: [strings('Prop', ['data', 'props']), ...WIREFRAME.lists],
  },
  store: { props: COMMON, lists: [strings('Key', ['data', 'keys'])] },
  service: { props: COMMON, lists: [strings('Method', ['data', 'methods'])] },
  job: {
    props: [...COMMON, { path: ['data', 'trigger'], label: 'Trigger' }, { path: ['data', 'schedule'], label: 'Schedule' }],
    lists: [],
  },
  external: { props: [...COMMON, { path: ['data', 'baseUrl'], label: 'Base URL' }], lists: [] },
  frame: { props: COMMON, lists: [] },
  sketch: { props: [{ path: ['data', 'text'], label: 'Text' }], lists: [] },
};

const MODEL_SPEC: DiffSpec = {
  props: [
    { path: ['name'], label: 'Name' },
    { path: ['description'], label: 'Description' },
  ],
  lists: [byId('Field', ['fields'], (f) => String(f.name))],
};

export const getPath = (value: unknown, path: DiffPath): unknown =>
  path.reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Item)[k] : undefined), value);

/** A copy of `value` with `path` set (missing objects on the way are created) */
export function setPath<T>(value: T, path: DiffPath, next: unknown): T {
  if (path.length === 0) return next as T;
  const [head, ...rest] = path as [string, ...string[]];
  const obj = (value ?? {}) as Item;
  const child = setPath(obj[head], rest, next);
  const copy = { ...obj };
  if (child === undefined) delete copy[head];
  else copy[head] = child;
  return copy as T;
}

const without = (item: unknown, ignore: readonly string[] = []) => {
  if (ignore.length === 0 || item === null || typeof item !== 'object') return item;
  const copy = { ...(item as Item) };
  for (const k of ignore) delete copy[k];
  return copy;
};

function diffList(before: unknown, after: unknown, spec: ListSpec): DiffEntry[] {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  const old = new Map(a.map((item) => [spec.key(item), item]));
  const now = new Set(b.map((item) => spec.key(item)));
  const entries: DiffEntry[] = [];
  const base = { path: spec.path, label: spec.label };
  for (const item of b) {
    const key = spec.key(item);
    const prev = old.get(key);
    if (prev === undefined) {
      entries.push({ ...base, type: 'added', key, name: spec.name(item), after: item });
      continue;
    }
    const x = without(prev, spec.ignore);
    const y = without(item, spec.ignore);
    if (sameValue(x, y)) continue;
    const fields =
      x !== null && typeof x === 'object' && y !== null && typeof y === 'object'
        ? [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => !sameValue((x as Item)[k], (y as Item)[k]))
        : [];
    entries.push({ ...base, type: 'changed', key, name: spec.name(item), before: prev, after: item, fields });
  }
  for (const item of a)
    if (!now.has(spec.key(item))) entries.push({ ...base, type: 'removed', key: spec.key(item), name: spec.name(item), before: item });
  return entries;
}

function diffWith(spec: DiffSpec, before: unknown, after: unknown): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const missing = new Set<string>();
  for (const prop of spec.props) {
    const x = getPath(before, prop.path);
    const y = getPath(after, prop.path);
    if (prop.presence) {
      // Lists inside something that was added or removed as a whole are not listed one by one
      if ((x === undefined) !== (y === undefined)) {
        missing.add(prop.path.join('.'));
        entries.push({ type: 'prop', path: prop.path, label: prop.label, before: x, after: y });
      }
      continue;
    }
    if (prop.path.slice(0, -1).some((_, i) => missing.has(prop.path.slice(0, i + 1).join('.')))) continue;
    if (!sameValue(x, y)) entries.push({ type: 'prop', path: prop.path, label: prop.label, before: x, after: y });
  }
  for (const list of spec.lists) {
    if (list.path.some((_, i) => missing.has(list.path.slice(0, i + 1).join('.')))) continue;
    entries.push(...diffList(getPath(before, list.path), getPath(after, list.path), list));
  }
  return entries;
}

/** What changed from `baseline` to `current` (same node, so the same type); nothing for different types */
export const diffNode = (baseline: CanvasNode, current: CanvasNode): DiffEntry[] =>
  baseline.type === current.type ? diffWith(NODE_SPECS[current.type], baseline, current) : [];

export const diffModel = (baseline: ApiModel, current: ApiModel): DiffEntry[] => diffWith(MODEL_SPEC, baseline, current);

function listSpecFor(entry: DiffEntry, kind: 'node' | 'model', type?: NodeType): ListSpec | undefined {
  const spec = kind === 'model' ? MODEL_SPEC : type ? NODE_SPECS[type] : undefined;
  return spec?.lists.find((l) => l.path.join('.') === entry.path.join('.'));
}

/**
 * Undoes one entry on `current`, taking the value from `baseline`: a property gets its old value,
 * an added item is dropped, a removed one comes back at its old place, a changed one gets its old
 * fields (layout like an element's position stays). The caller re-validates the result.
 */
export function revertEntry<T extends CanvasNode | ApiModel>(current: T, baseline: T, entry: DiffEntry): T {
  if (entry.type === 'prop') return setPath(current, entry.path, getPath(baseline, entry.path));
  const list = listSpecFor(entry, 'type' in current ? 'node' : 'model', 'type' in current ? current.type : undefined);
  if (!list) return current;
  const items = (getPath(current, entry.path) as unknown[] | undefined) ?? [];
  const old = (getPath(baseline, entry.path) as unknown[] | undefined) ?? [];
  const oldItem = old.find((i) => list.key(i) === entry.key);
  let next: unknown[];
  if (entry.type === 'added') next = items.filter((i) => list.key(i) !== entry.key);
  else if (entry.type === 'removed') {
    if (oldItem === undefined) return current;
    const at = Math.min(old.indexOf(oldItem), items.length);
    next = [...items.slice(0, at), oldItem, ...items.slice(at)];
  } else {
    if (oldItem === undefined) return current;
    next = items.map((i) => {
      if (list.key(i) !== entry.key) return i;
      const kept = Object.fromEntries((list.ignore ?? []).map((k) => [k, (i as Item)[k]]));
      return { ...(oldItem as Item), ...kept };
    });
  }
  return setPath(current, entry.path, next);
}

const show = (v: unknown): string =>
  v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? (Array.isArray(v) ? v.map(show).join(', ') : '…') : String(v);

/**
 * One line per entry, e.g. "Path: /orders → /orders/{id}", "+ Column wish_count",
 * "~ Column email: type text → citext", "− Param query page".
 */
export function describeEntry(entry: DiffEntry): string {
  if (entry.type === 'prop') {
    const objects = [entry.before, entry.after].some((v) => v !== null && typeof v === 'object');
    if (!objects) return `${entry.label}: ${show(entry.before)} → ${show(entry.after)}`;
    if (entry.before === undefined) return `${entry.label} added`;
    if (entry.after === undefined) return `${entry.label} removed`;
    return `${entry.label} changed`;
  }
  if (entry.type === 'added') return `+ ${entry.label} ${entry.name}`;
  if (entry.type === 'removed') return `− ${entry.label} ${entry.name}`;
  const details = changedFields(entry);
  return `~ ${entry.label} ${entry.name}${details ? `: ${details}` : ''}`;
}

/** What changed on a changed list item: "type text → citext, nullable true → false" ('' for other entries) */
export function changedFields(entry: DiffEntry): string {
  if (entry.type !== 'changed') return '';
  const before = entry.before as Item;
  const after = entry.after as Item;
  return (entry.fields ?? [])
    .map((f) => ([before[f], after[f]].some((v) => v !== null && typeof v === 'object') ? f : `${f} ${show(before[f])} → ${show(after[f])}`))
    .join(', ');
}
