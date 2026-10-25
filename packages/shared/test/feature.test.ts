import { describe, expect, it } from 'vitest';
import {
  CanvasDoc,
  emptyCanvas,
  Feature,
  featureById,
  pruneFeatures,
  removeFeatureItem,
  roleOf,
  setFeatureItem,
  tagChanges,
  type CanvasNode,
  type FeatureItemRef,
} from '../src';

const table = (id: string, columns: string[] = ['id']) => ({
  id,
  type: 'table',
  label: id,
  position: { x: 0, y: 0 },
  data: { columns: columns.map((c) => ({ id: `${id}_${c}`, name: c, type: 'uuid' })) },
});

/** users and orders tables, POST /orders writing orders, a model and a flow; feature `f` uses users */
const raw = (features: unknown[] = [{ id: 'f', name: 'Wishlist' }]) => ({
    ...emptyCanvas(),
    nodes: [
      table('users', ['id', 'email']),
      table('orders'),
      { id: 'post', type: 'endpoint', position: { x: 0, y: 0 }, data: { method: 'POST', path: '/orders' } },
      { id: 'note', type: 'sketch', position: { x: 0, y: 0 }, data: { shape: 'sticky', text: 'hi' } },
    ],
    edges: [{ id: 'w', kind: 'writes', source: 'post', target: 'orders' }],
    flows: [{ id: 'flow', name: 'Order', steps: [{ edgeId: 'w' }] }],
    models: [{ id: 'm', name: 'OrderDto', fields: [] }],
    features,
  });
const base = (features?: unknown[]) => CanvasDoc.parse(raw(features));

const issues = (input: unknown) => {
  const result = CanvasDoc.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

const node = (id: string): FeatureItemRef => ({ kind: 'node', id });
const feature = (doc: CanvasDoc, id = 'f') => featureById(doc, id)!;
const nodeOf = (doc: CanvasDoc, id: string) => doc.nodes.find((n) => n.id === id)!;
const withNode = (doc: CanvasDoc, next: CanvasNode): CanvasDoc => ({
  ...doc,
  nodes: doc.nodes.map((n) => (n.id === next.id ? next : n)),
});
const withColumn = (doc: CanvasDoc, id: string, column: string): CanvasDoc => {
  const t = nodeOf(doc, id);
  if (t.type !== 'table') throw new Error('not a table');
  const columns = [...t.data.columns, { id: `${id}_${column}`, name: column, type: 'text', primaryKey: false, nullable: true, unique: false }];
  return withNode(doc, { ...t, data: { ...t.data, columns } });
};

describe('Feature schema', () => {
  it('fills defaults, and docs without features parse', () => {
    expect(Feature.parse({ id: 'f', name: ' Wishlist ' })).toEqual({
      id: 'f',
      name: 'Wishlist',
      status: 'draft',
      acceptance: [],
      openQuestions: [],
      items: [],
      flowIds: [],
      baseline: { nodes: {}, models: {} },
    });
    const { features: _, ...legacy } = emptyCanvas();
    expect(CanvasDoc.parse(legacy).features).toEqual([]);
  });

  it('accepts items of every kind, a changed baseline and flows', () => {
    const doc = raw([
      {
        id: 'f',
        name: 'Wishlist',
        items: [
          { ref: node('users'), role: 'uses', note: 'reads the owner' },
          { ref: node('orders'), role: 'changed', progress: 'todo' },
          { ref: { kind: 'edge', id: 'w' }, role: 'added' },
          { ref: { kind: 'model', id: 'm' }, role: 'removed' },
        ],
        baseline: { nodes: { orders: table('orders') } },
        flowIds: ['flow'],
      },
    ]);
    expect(issues(doc)).toEqual([]);
  });

  it('rejects unknown items, unknown flows and duplicates', () => {
    const doc = raw([
      {
        id: 'f',
        name: 'A',
        items: [
          { ref: node('nope'), role: 'uses' },
          { ref: { kind: 'edge', id: 'users' }, role: 'uses' },
          { ref: node('users'), role: 'uses' },
          { ref: node('users'), role: 'changed' },
        ],
        flowIds: ['flow', 'flow', 'gone'],
      },
      { id: 'f', name: 'B' },
    ]);
    expect(issues(doc)).toEqual([
      'Unknown node nope',
      'Unknown edge users',
      'Item is already in this feature',
      'Duplicate flow',
      'Unknown flow gone',
      'Duplicate feature id',
    ]);
  });

  it('lets several features use or change an item, but only one add it', () => {
    const items = (role: string) => [{ ref: node('orders'), role }];
    expect(issues(raw([{ id: 'a', name: 'A', items: items('uses') }, { id: 'b', name: 'B', items: items('uses') }]))).toEqual([]);
    expect(issues(raw([{ id: 'a', name: 'A', items: items('added') }, { id: 'b', name: 'B', items: items('changed') }]))).toEqual([]);
    expect(issues(raw([{ id: 'a', name: 'A', items: items('added') }, { id: 'b', name: 'B', items: items('added') }]))).toEqual([
      'Item is already added by another feature',
    ]);
  });

  it('keeps baselines only for changed items that match them', () => {
    const withBaseline = (role: string, original: unknown) =>
      raw([{ id: 'f', name: 'A', items: [{ ref: node('orders'), role }], baseline: { nodes: { orders: original } } }]);
    expect(issues(withBaseline('uses', table('orders')))).toEqual(['Only changed items keep a baseline']);
    expect(issues(withBaseline('changed', table('users')))).toEqual(['Baseline does not match the item']);
    expect(
      issues(withBaseline('changed', { id: 'orders', type: 'screen', position: { x: 0, y: 0 }, data: {} })),
    ).toEqual(['Baseline does not match the item']);
    expect(issues(raw([{ id: 'f', name: 'A', baseline: { models: { m: { id: 'm', name: 'Old', fields: [] } } } }]))).toEqual([
      'Only changed items keep a baseline',
    ]);
  });
});

describe('setFeatureItem / removeFeatureItem', () => {
  it('adds, retags and removes items', () => {
    let doc = setFeatureItem(base(), 'f', node('users'), 'uses');
    expect(feature(doc).items).toEqual([{ ref: node('users'), role: 'uses' }]);
    doc = setFeatureItem(doc, 'f', node('users'), 'removed');
    expect(feature(doc).items).toEqual([{ ref: node('users'), role: 'removed' }]);
    doc = removeFeatureItem(doc, 'f', node('users'));
    expect(feature(doc).items).toEqual([]);
    expect(setFeatureItem(doc, 'missing', node('users'), 'uses')).toBe(doc);
  });

  it('keeps the first baseline of a changed item and drops it with another role', () => {
    const original = nodeOf(base(), 'orders');
    let doc = setFeatureItem(base(), 'f', node('orders'), 'changed', original);
    doc = setFeatureItem(doc, 'f', node('orders'), 'changed', nodeOf(withColumn(doc, 'orders', 'later'), 'orders'));
    expect(feature(doc).baseline.nodes.orders).toBe(original);
    expect(CanvasDoc.safeParse(doc).success).toBe(true);

    doc = setFeatureItem(doc, 'f', node('orders'), 'uses');
    expect(feature(doc).baseline.nodes).toEqual({});
    doc = setFeatureItem(doc, 'f', node('orders'), 'changed', original);
    expect(removeFeatureItem(doc, 'f', node('orders')).features[0]!.baseline.nodes).toEqual({});
  });

  it('moves an item added by another feature', () => {
    let doc = base([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    doc = setFeatureItem(doc, 'a', node('orders'), 'added');
    doc = setFeatureItem(doc, 'b', node('orders'), 'added');
    expect(feature(doc, 'a').items).toEqual([]);
    expect(roleOf(feature(doc, 'b'), node('orders'))).toBe('added');
    expect(CanvasDoc.safeParse(doc).success).toBe(true);
  });
});

describe('pruneFeatures', () => {
  it('drops items, baselines and flows that no longer exist', () => {
    let doc = setFeatureItem(base(), 'f', node('orders'), 'changed', nodeOf(base(), 'orders'));
    doc = setFeatureItem(doc, 'f', { kind: 'edge', id: 'w' }, 'uses');
    doc = setFeatureItem(doc, 'f', { kind: 'model', id: 'm' }, 'uses');
    doc = setFeatureItem(doc, 'f', node('users'), 'uses');
    doc = { ...doc, features: [{ ...feature(doc), flowIds: ['flow'] }] };
    expect(pruneFeatures(doc)).toBe(doc);

    const pruned = pruneFeatures({
      ...doc,
      nodes: doc.nodes.filter((n) => n.id !== 'orders'),
      edges: [],
      flows: [],
      models: [],
    });
    expect(feature(pruned).items).toEqual([{ ref: node('users'), role: 'uses' }]);
    expect(feature(pruned).baseline).toEqual({ nodes: {}, models: {} });
    expect(feature(pruned).flowIds).toEqual([]);
  });
});

describe('tagChanges', () => {
  it('tags new nodes, edges and models as added', () => {
    const prev = base();
    const next: CanvasDoc = {
      ...prev,
      nodes: [...prev.nodes, CanvasDoc.parse({ ...emptyCanvas(), nodes: [table('wishlist')] }).nodes[0]!],
      edges: [...prev.edges, { id: 'r', kind: 'reads', source: 'post', target: 'users' }],
      models: [...prev.models, { id: 'm2', name: 'WishDto', fields: [] }],
    };
    const tagged = tagChanges(prev, next, 'f');
    expect(feature(tagged).items).toEqual([
      { ref: node('wishlist'), role: 'added' },
      { ref: { kind: 'edge', id: 'r' }, role: 'added' },
      { ref: { kind: 'model', id: 'm2' }, role: 'added' },
    ]);
    expect(CanvasDoc.safeParse(tagged).success).toBe(true);
  });

  it('tags an edited node as changed with the version before the first edit as baseline', () => {
    const prev = setFeatureItem(base(), 'f', node('users'), 'uses');
    const once = tagChanges(prev, withColumn(prev, 'users', 'rating'), 'f');
    expect(roleOf(feature(once), node('users'))).toBe('changed');
    expect(feature(once).baseline.nodes.users).toBe(nodeOf(prev, 'users'));

    const twice = tagChanges(once, withColumn(once, 'users', 'wish_count'), 'f');
    expect(feature(twice).baseline.nodes.users).toBe(nodeOf(prev, 'users'));
    expect(CanvasDoc.safeParse(twice).success).toBe(true);
  });

  it('tags edited edges and models as changed (models with a baseline)', () => {
    const prev = base();
    const next: CanvasDoc = {
      ...prev,
      edges: [{ id: 'w', kind: 'writes', source: 'post', target: 'orders', crud: ['create'] }],
      models: [{ id: 'm', name: 'OrderDto', description: 'An order', fields: [] }],
    };
    const tagged = tagChanges(prev, next, 'f');
    expect(feature(tagged).items.map((i) => [i.ref.id, i.role])).toEqual([
      ['w', 'changed'],
      ['m', 'changed'],
    ]);
    expect(feature(tagged).baseline.models.m).toBe(prev.models[0]);
  });

  it('keeps added, changed and removed roles', () => {
    let prev = setFeatureItem(base(), 'f', node('orders'), 'added');
    prev = setFeatureItem(prev, 'f', node('users'), 'removed');
    const tagged = tagChanges(prev, withColumn(withColumn(prev, 'orders', 'x'), 'users', 'y'), 'f');
    expect(feature(tagged).items).toEqual(feature(prev).items);
    expect(feature(tagged).baseline.nodes).toEqual({});
  });

  it('ignores moves, resizes, unchanged copies, sketches and arrows', () => {
    const prev = base();
    const moved = prev.nodes.map((n) => ({ ...n, position: { x: 50, y: 50 }, size: { width: 10, height: 10 } }));
    const reparsed = CanvasDoc.parse(JSON.parse(JSON.stringify(prev)) as unknown);
    const sticky = nodeOf(prev, 'note');
    if (sticky.type !== 'sketch') throw new Error('not a sketch');
    const next: CanvasDoc = {
      ...withNode({ ...prev, nodes: moved }, { ...sticky, data: { ...sticky.data, text: 'changed' } }),
      edges: [...reparsed.edges, { id: 'a', kind: 'arrow', source: 'note', target: 'users' }],
      models: reparsed.models,
    };
    expect(tagChanges(prev, next, 'f')).toBe(next);
  });

  it('does nothing without the feature', () => {
    const prev = base();
    const next = withColumn(prev, 'users', 'x');
    expect(tagChanges(prev, next, 'missing')).toBe(next);
  });
});
