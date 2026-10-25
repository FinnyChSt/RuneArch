import { CanvasDoc, setFeatureItem, type TableNode } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { shopDoc } from '../test/fixtures';
import { featureView, itemsByRole, itemTitle, nextFeatureColor, unshippedIds } from './featureView';
import { createNodeMapper, toFlowEdges, type ViewState } from './mapping';

const view = (over: Partial<ViewState> = {}): ViewState => ({
  selection: new Set(),
  invalid: new Set(),
  measured: {},
  dragPositions: {},
  ...over,
});

const table = (doc: CanvasDoc, id: string) => doc.nodes.find((n): n is TableNode => n.id === id && n.type === 'table')!;

/**
 * shopDoc with feature `f` (teal): users changed (email changed, rating added, id dropped), orders
 * used, the writes edge added; feature `g` (draft) adds POST /orders, `s` (shipped) adds GET /orders.
 */
function featureDoc(): CanvasDoc {
  let doc = CanvasDoc.parse({
    ...shopDoc(),
    features: [
      { id: 'f', name: 'Wishlist', color: 'teal' },
      { id: 'g', name: 'Checkout' },
      { id: 's', name: 'Orders', status: 'shipped' },
    ],
  });
  const users = table(doc, 'users');
  const [id, email] = users.data.columns;
  const rating = { id: 'u_rating', name: 'rating', type: 'int', primaryKey: false, nullable: true, unique: false };
  const changed: TableNode = { ...users, data: { ...users.data, columns: [{ ...email!, type: 'citext' }, rating] } };
  doc = setFeatureItem(doc, 'f', { kind: 'node', id: 'users' }, 'changed', users);
  doc = { ...doc, nodes: doc.nodes.map((n) => (n.id === 'users' ? changed : n)), edges: doc.edges.filter((e) => e.id !== 'fk') };
  doc = setFeatureItem(doc, 'f', { kind: 'node', id: 'orders' }, 'uses');
  doc = setFeatureItem(doc, 'f', { kind: 'edge', id: 'w' }, 'added');
  doc = setFeatureItem(doc, 'g', { kind: 'node', id: 'post' }, 'added');
  doc = setFeatureItem(doc, 's', { kind: 'node', id: 'get' }, 'added');
  expect(id?.id).toBe('u_id');
  return CanvasDoc.parse(doc);
}

describe('featureView', () => {
  it('maps roles and marks the columns of changed tables', () => {
    const fv = featureView(featureDoc(), 'f')!;
    expect(fv.color).toBe('var(--flow-teal)');
    expect([...fv.roles]).toEqual([
      ['node:users', 'changed'],
      ['node:orders', 'uses'],
      ['edge:w', 'added'],
    ]);
    expect(fv.columns.get('users')).toEqual({
      marks: { u_email: 'changed', u_rating: 'added' },
      dropped: [{ id: 'u_id', name: 'id', type: 'uuid' }],
    });
    expect(featureView(featureDoc(), 'nope')).toBeNull();
    expect(featureView(featureDoc(), null)).toBeNull();
  });

  it('lists what unshipped features add, keeping the named ones', () => {
    const doc = featureDoc();
    expect([...unshippedIds(doc)].sort()).toEqual(['post', 'w']);
    expect([...unshippedIds(doc, ['g', null])]).toEqual(['w']);
  });

  it('groups items, names them and picks a free color', () => {
    const doc = featureDoc();
    const groups = itemsByRole(doc.features[0]!);
    expect(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]))).toEqual({
      added: 1,
      changed: 1,
      removed: 0,
      uses: 1,
    });
    expect(itemTitle(doc, { kind: 'node', id: 'post' })).toBe('POST /orders');
    expect(itemTitle(doc, { kind: 'edge', id: 'w' })).toBe('POST /orders → orders · writes');
    expect(nextFeatureColor(doc)).toBe('violet');
  });
});

describe('mapping with a feature', () => {
  it('badges feature items, dims the rest and passes column marks to tables', () => {
    const doc = featureDoc();
    const nodes = createNodeMapper()(doc, view({ feature: featureView(doc, 'f') }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId.users!.className).toBe('fc-feat fc-feat-changed');
    expect(byId.orders!.className).toBe('fc-feat fc-feat-uses');
    expect(byId.post!.className).toBe('is-dimmed');
    expect(byId.users!.data.columnMarks?.marks).toEqual({ u_email: 'changed', u_rating: 'added' });
    expect(byId.orders!.data.columnMarks).toBeUndefined();

    const [w] = toFlowEdges(doc, view({ feature: featureView(doc, 'f') }));
    expect(w!.className).toBe('fc-feat fc-feat-added');
    expect(w!.data?.flow).toEqual({ color: 'var(--flow-teal)', current: false, dimmed: false, accent: true });
  });

  it('hides unshipped additions and the edges touching them', () => {
    const doc = featureDoc();
    const hidden = unshippedIds(doc);
    const nodes = createNodeMapper()(doc, view({ hidden }));
    expect(nodes.filter((n) => n.hidden).map((n) => n.id)).toEqual(['post']);
    expect(toFlowEdges(doc, view({ hidden })).map((e) => e.hidden)).toEqual([true]);
  });
});

describe('element and field markers', () => {
  it('marks wireframe elements and model fields the feature adds or changes', () => {
    const el = (id: string, text: string) => ({ id, kind: 'text', text, rect: { x: 0, y: 0, w: 4, h: 2 } });
    const screenBase = { id: 's', type: 'screen', label: 'Product', position: { x: 0, y: 0 }, data: { wireframe: { elements: [el('a', 'Title'), el('b', 'Price')] } } };
    const field = (id: string, name: string) => ({ id, name, type: { kind: 'primitive', type: 'string' } });
    const modelBase = { id: 'm', name: 'ProductDto', fields: [field('x', 'name')] };
    const doc = CanvasDoc.parse({
      ...shopDoc(),
      nodes: [...shopDoc().nodes, { ...screenBase, data: { wireframe: { elements: [el('a', 'Title'), el('b', 'Price incl. tax'), el('c', 'Wish')] } } }],
      models: [{ ...modelBase, fields: [field('x', 'name'), field('y', 'wished')] }],
      features: [
        {
          id: 'f',
          name: 'Wishlist',
          items: [
            { ref: { kind: 'node', id: 's' }, role: 'changed' },
            { ref: { kind: 'model', id: 'm' }, role: 'changed' },
          ],
          baseline: { nodes: { s: screenBase }, models: { m: modelBase } },
        },
      ],
    });
    const fv = featureView(doc, 'f')!;
    expect(fv.elements.get('s')).toEqual({ b: 'changed', c: 'added' });
    expect(fv.fields.get('m')).toEqual({ y: 'added' });

    const screen = createNodeMapper()(doc, view({ feature: fv })).find((n) => n.id === 's')!;
    expect(screen.data.elementMarks).toEqual({ b: 'changed', c: 'added' });
  });
});
