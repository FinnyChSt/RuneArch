import { CanvasDoc, diffNode, featureById, roleOf, type FeatureItemRef, type TableNode } from '@flowcanvas/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { shopDoc } from '../test/fixtures';
import { redo, undo, useCanvasStore } from './canvasStore';

const store = () => useCanvasStore.getState();
const history = () => useCanvasStore.temporal.getState().pastStates.length;
const feature = (id: string) => featureById(store().doc, id)!;
const role = (id: string, ref: FeatureItemRef) => roleOf(feature(id), ref);
const node = (id: string): FeatureItemRef => ({ kind: 'node', id });
const table = (id: string) => store().doc.nodes.find((n): n is TableNode => n.id === id && n.type === 'table')!;
const expectValid = () => expect(() => CanvasDoc.parse(store().doc)).not.toThrow();

/** The users table with one more column, as the table dialog saves it */
const usersWithRating = (): TableNode => {
  const users = table('users');
  const rating = { id: 'u_rating', name: 'rating', type: 'int', primaryKey: false, nullable: true, unique: false };
  return { ...users, data: { ...users.data, columns: [...users.data.columns, rating] } };
};

beforeEach(() => store().load(shopDoc(), 1, 'p1'));

describe('features', () => {
  it('creates, saves and removes features, each one undo step', () => {
    const id = store().addFeature({ name: ' Wishlist ', color: 'teal' });
    expect(feature(id)).toMatchObject({ name: 'Wishlist', color: 'teal', status: 'draft', items: [] });
    store().saveFeature({ ...feature(id), status: 'in-progress', acceptance: ['Users can save products'] });
    expect(feature(id)).toMatchObject({ status: 'in-progress', acceptance: ['Users can save products'] });
    expect(history()).toBe(2);
    expect(store().saveState).toBe('dirty');

    store().setActiveFeature(id);
    store().removeFeature(id);
    expect(store().doc.features).toEqual([]);
    expect(store().activeFeatureId).toBeNull();
    undo();
    expect(feature(id).status).toBe('in-progress');
  });

  it('only activates features that exist, and a load clears the active one', () => {
    store().setActiveFeature('nope');
    expect(store().activeFeatureId).toBeNull();
    const id = store().addFeature({ name: 'Wishlist' });
    store().setActiveFeature(id);
    expect(store().activeFeatureId).toBe(id);
    store().load(shopDoc(), 1, 'p1');
    expect(store().activeFeatureId).toBeNull();
  });

  it('tags nothing without an active feature', () => {
    const id = store().addFeature({ name: 'Wishlist' });
    store().addNode('table', { x: 0, y: 0 });
    store().editNode(usersWithRating());
    expect(feature(id).items).toEqual([]);
  });

  describe('with an active feature', () => {
    let id: string;
    beforeEach(() => {
      id = store().addFeature({ name: 'Wishlist' });
      store().setActiveFeature(id);
    });

    it('tags new nodes, edges and models as added in the same undo step', () => {
      const steps = history();
      const wishlist = store().addNode('table', { x: 0, y: 0 });
      const endpoint = store().addNode('endpoint', { x: 0, y: 0 });
      store().connect({ source: endpoint, target: wishlist });
      store().upsertModel({ id: 'wish', name: 'WishDto', fields: [] });
      expect(history()).toBe(steps + 4);

      const edge = store().doc.edges.at(-1)!.id;
      expect(feature(id).items).toEqual([
        { ref: node(wishlist), role: 'added' },
        { ref: node(endpoint), role: 'added' },
        { ref: { kind: 'edge', id: edge }, role: 'added' },
        { ref: { kind: 'model', id: 'wish' }, role: 'added' },
      ]);
      expectValid();

      undo();
      expect(feature(id).items).toHaveLength(3);
      redo();
      expect(feature(id).items).toHaveLength(4);
    });

    it('tags an edited table as changed and keeps the original as baseline', () => {
      const original = table('users');
      store().setFeatureItem(id, node('users'), 'uses');
      store().editNode(usersWithRating());
      expect(role(id, node('users'))).toBe('changed');
      expect(feature(id).baseline.nodes.users).toEqual(original);
      expectValid();

      undo();
      expect(role(id, node('users'))).toBe('uses');
      expect(feature(id).baseline.nodes).toEqual({});
    });

    it('does not tag moves, sketches, arrows or a dialect switch', () => {
      store().applyNodeChanges([{ type: 'position', id: 'users', position: { x: 99, y: 99 }, dragging: false }]);
      const sticky = store().addNode('sticky', { x: 0, y: 0 });
      store().connect({ source: sticky, target: 'users' });
      store().setDatabaseDialect('mysql');
      expect(table('users').position).toEqual({ x: 99, y: 99 });
      expect(feature(id).items).toEqual([]);
    });

    it('removes the items of deleted nodes and edges', () => {
      const wishlist = store().addNode('table', { x: 0, y: 0 });
      store().setFeatureItem(id, { kind: 'edge', id: 'w' }, 'uses');
      store().removeElements([wishlist, 'post']);
      expect(feature(id).items).toEqual([]);
      expectValid();
    });

    it('marks items by hand: existing, removed, changed with a baseline, and untagged', () => {
      store().setFeatureItem(id, node('orders'), 'uses');
      store().setFeatureItem(id, node('get'), 'removed');
      store().setFeatureItem(id, { kind: 'edge', id: 'fk' }, 'changed');
      store().setFeatureItem(id, node('users'), 'changed');
      expect(feature(id).baseline.nodes.users).toEqual(table('users'));
      store().setFeatureItem(id, node('missing'), 'uses');
      expect(feature(id).items.map((i) => [i.ref.id, i.role])).toEqual([
        ['orders', 'uses'],
        ['get', 'removed'],
        ['fk', 'changed'],
        ['users', 'changed'],
      ]);
      store().removeFeatureItem(id, node('users'));
      expect(feature(id).baseline.nodes).toEqual({});
      expectValid();
    });

    it('moves an added item when another feature adds it', () => {
      const wishlist = store().addNode('table', { x: 0, y: 0 });
      const other = store().addFeature({ name: 'Favorites' });
      store().setFeatureItem(other, node(wishlist), 'added');
      expect(feature(id).items).toEqual([]);
      expect(role(other, node(wishlist))).toBe('added');
      expectValid();
    });

    it('drops the flows of a feature when the flow is removed', () => {
      store().saveFeature({ ...feature(id), flowIds: ['f'] });
      store().removeFlow('f');
      expect(feature(id).flowIds).toEqual([]);
      expectValid();
    });
  });
});

describe('reverting changes', () => {
  let id: string;
  /** users gets a rating column with an FK to orders.id; then the feature reverts parts of it */
  beforeEach(() => {
    id = store().addFeature({ name: 'Wishlist' });
    store().setActiveFeature(id);
    store().editNode(usersWithRating(), [
      { columnId: 'u_rating', target: { tableId: 'orders', columnId: 'o_id' }, onDelete: 'no action' },
    ]);
    expect(store().doc.edges.some((e) => e.kind === 'fk' && e.source === 'users')).toBe(true);
  });

  const entries = () => diffNode(feature(id).baseline.nodes.users!, table('users'));

  it('reverts one change and drops the FK of a column it removes, in one undo step', () => {
    const [added] = entries();
    expect(added).toMatchObject({ type: 'added', name: 'rating' });
    const steps = history();
    expect(store().revertFeatureEntry(id, node('users'), added!)).toEqual({ ok: true });
    expect(table('users').data.columns.map((c) => c.name)).toEqual(['id', 'email']);
    expect(store().doc.edges.some((e) => e.kind === 'fk' && e.source === 'users')).toBe(false);
    // Nothing differs any more: the table is just used again
    expect(role(id, node('users'))).toBe('uses');
    expect(history()).toBe(steps + 1);
    expectValid();
    undo();
    expect(role(id, node('users'))).toBe('changed');
  });

  it('reverts a whole item, keeping it where it is on the canvas', () => {
    store().applyNodeChanges([{ type: 'position', id: 'users', position: { x: 70, y: 80 }, dragging: false }]);
    expect(store().revertFeatureItem(id, node('users'))).toEqual({ ok: true });
    expect(table('users').data.columns.map((c) => c.name)).toEqual(['id', 'email']);
    expect(table('users').position).toEqual({ x: 70, y: 80 });
    expect(role(id, node('users'))).toBe('uses');
  });

  it('refuses a revert that would leave the doc invalid', () => {
    store().upsertModel({ id: 'dto', name: 'UserDto', fields: [] });
    store().setFeatureItem(id, { kind: 'model', id: 'dto' }, 'uses');
    store().upsertModel({ id: 'tmp', name: 'Tmp', fields: [] });
    store().upsertModel({ id: 'dto', name: 'UserDto', fields: [{ id: 'f', name: 'tmp', type: { kind: 'ref', modelId: 'tmp' }, required: true, nullable: false }] });
    // A baseline that points at a model deleted since cannot come back
    const base = feature(id).baseline.models.dto!;
    store().saveFeature({ ...feature(id), baseline: { ...feature(id).baseline, models: { dto: { ...base, fields: [{ id: 'g', name: 'gone', type: { kind: 'ref', modelId: 'gone' }, required: true, nullable: false }] } } } });
    const before = store().doc;
    const result = store().revertFeatureItem(id, { kind: 'model', id: 'dto' });
    expect(result).toEqual({ ok: false, reason: "Can't revert: Unknown model gone" });
    expect(store().doc).toBe(before);
    expect(store().revertFeatureItem(id, node('orders'))).toMatchObject({ ok: false });
  });
});
