import { describe, expect, it } from 'vitest';
import { CanvasDoc, discardFeature, emptyCanvas, featureById, featureChanges, featureConflicts, partName, shipFeature } from '../src';

const pos = { x: 0, y: 0 };
const col = (id: string, name: string, extra: object = {}) => ({ id, name, type: 'integer', ...extra });
const usersBase = { id: 'users', type: 'table', label: 'users', position: pos, data: { columns: [col('u_id', 'id', { primaryKey: true, nullable: false })] } };

/**
 * Wishlist changes users (adds wish_count), adds wishlist_items with an FK and POST /wishlist
 * (body WishDto), removes GET /favorites (which answers with FavDto, also used by GET /orders) and the
 * legacy frame-held table. Profiles (draft) adds bios, which Wishlist uses, and also changes users.
 */
function doc() {
  return CanvasDoc.parse({
    ...emptyCanvas(),
    nodes: [
      { id: 'lane', type: 'frame', label: 'Old', position: { x: 100, y: 100 }, size: { width: 400, height: 300 }, data: {} },
      { id: 'legacy', type: 'table', label: 'legacy', parentId: 'lane', position: { x: 10, y: 10 }, data: {} },
      { id: 'note', type: 'sketch', parentId: 'lane', position: { x: 20, y: 200 }, data: { shape: 'sticky', text: 'old stuff' } },
      { ...usersBase, data: { columns: [...usersBase.data.columns, col('u_wish', 'wish_count', { default: '0' })] } },
      { id: 'wish', type: 'table', label: 'wishlist_items', position: pos, data: { columns: [col('w_id', 'id', { primaryKey: true, nullable: false }), col('w_user', 'user_id')] } },
      { id: 'bios', type: 'table', label: 'bios', position: pos, data: {} },
      { id: 'post', type: 'endpoint', position: pos, data: { method: 'POST', path: '/wishlist', spec: { requestBody: { type: { kind: 'ref', modelId: 'wdto' } } } } },
      { id: 'fav', type: 'endpoint', position: pos, data: { method: 'GET', path: '/favorites', spec: { responses: [{ status: '200', body: { kind: 'ref', modelId: 'fdto' } }] } } },
      { id: 'orders', type: 'endpoint', position: pos, data: { method: 'GET', path: '/orders', spec: { responses: [{ status: '200', body: { kind: 'ref', modelId: 'fdto' } }] } } },
    ],
    edges: [
      { id: 'fk', kind: 'fk', source: 'wish', target: 'users', data: { sourceColumnId: 'w_user', targetColumnId: 'u_id' } },
      { id: 'write', kind: 'writes', source: 'post', target: 'wish' },
      { id: 'readfav', kind: 'reads', source: 'fav', target: 'users' },
      { id: 'readbio', kind: 'reads', source: 'post', target: 'bios' },
    ],
    flows: [{ id: 'fl', name: 'Favorites', steps: [{ edgeId: 'readfav' }] }],
    models: [
      { id: 'wdto', name: 'WishDto', fields: [] },
      { id: 'fdto', name: 'FavDto', fields: [] },
    ],
    features: [
      {
        id: 'f',
        name: 'Wishlist',
        items: [
          { ref: { kind: 'node', id: 'users' }, role: 'changed' },
          { ref: { kind: 'node', id: 'wish' }, role: 'added' },
          { ref: { kind: 'edge', id: 'fk' }, role: 'added' },
          { ref: { kind: 'node', id: 'post' }, role: 'added' },
          { ref: { kind: 'edge', id: 'write' }, role: 'added' },
          { ref: { kind: 'model', id: 'wdto' }, role: 'added' },
          { ref: { kind: 'node', id: 'fav' }, role: 'removed' },
          { ref: { kind: 'model', id: 'fdto' }, role: 'removed' },
          { ref: { kind: 'node', id: 'lane' }, role: 'removed' },
          { ref: { kind: 'node', id: 'legacy' }, role: 'removed' },
          { ref: { kind: 'node', id: 'bios' }, role: 'uses' },
        ],
        baseline: { nodes: { users: usersBase } },
      },
      {
        id: 'p',
        name: 'Profiles',
        items: [
          { ref: { kind: 'node', id: 'bios' }, role: 'added' },
          { ref: { kind: 'node', id: 'users' }, role: 'changed' },
          { ref: { kind: 'node', id: 'legacy' }, role: 'uses' },
        ],
        baseline: { nodes: { users: usersBase } },
      },
    ],
  });
}

describe('shipFeature', () => {
  it('deletes what the feature removes, keeps its work as plain project, and marks it shipped', () => {
    const result = shipFeature(doc(), 'f');
    if (!result.ok) throw new Error(result.reason);
    const d = result.doc;
    expect(d.nodes.map((n) => n.id)).toEqual(['note', 'users', 'wish', 'bios', 'post', 'orders']);
    // The sticky of the deleted frame keeps its place on the canvas
    expect(d.nodes.find((n) => n.id === 'note')).toMatchObject({ parentId: undefined, position: { x: 120, y: 300 } });
    expect(d.edges.map((e) => e.id)).toEqual(['fk', 'write', 'readbio']);
    expect(d.flows[0]!.steps).toEqual([]);
    // FavDto is still used by GET /orders, so it stays
    expect(d.models.map((m) => m.name)).toEqual(['WishDto', 'FavDto']);
    const shipped = featureById(d, 'f')!;
    expect(shipped.status).toBe('shipped');
    expect(shipped.baseline).toEqual({ nodes: {}, models: {} });
    expect(shipped.items.map((i) => `${i.ref.id}:${i.role}`)).toEqual([
      'users:changed',
      'wish:added',
      'fk:added',
      'post:added',
      'write:added',
      'wdto:added',
      'fdto:removed',
      'bios:uses',
    ]);
    // Other features lose items that are gone
    expect(featureById(d, 'p')!.items.map((i) => i.ref.id)).toEqual(['bios', 'users']);
    expect(result.warnings).toEqual([
      'Profiles is not shipped yet, and Wishlist relies on what it adds (1 item)',
      'FavDto stays: something still uses it',
    ]);
  });

  it('refuses an unknown feature', () => {
    expect(shipFeature(doc(), 'nope')).toEqual({ ok: false, reason: 'Unknown feature' });
  });
});

describe('discardFeature', () => {
  it('deletes the additions, restores the changes, keeps the removed parts, and drops the feature', () => {
    const result = discardFeature(doc(), 'f');
    if (!result.ok) throw new Error(result.reason);
    const d = result.doc;
    expect(d.nodes.map((n) => n.id)).toEqual(['lane', 'legacy', 'note', 'users', 'bios', 'fav', 'orders']);
    const users = d.nodes.find((n) => n.id === 'users');
    expect(users?.type === 'table' && users.data.columns.map((c) => c.name)).toEqual(['id']);
    expect(d.edges.map((e) => e.id)).toEqual(['readfav']);
    expect(d.models.map((m) => m.name)).toEqual(['FavDto']);
    expect(d.features.map((f) => f.id)).toEqual(['p']);
    expect(result.warnings).toEqual([]);
  });

  it('keeps an added model something else still uses', () => {
    const d = CanvasDoc.parse({
      ...doc(),
      nodes: doc().nodes.map((n) =>
        n.id === 'orders' && n.type === 'endpoint'
          ? { ...n, data: { ...n.data, spec: { ...n.data.spec, responses: [{ status: '200', description: '', body: { kind: 'ref', modelId: 'wdto' } }] } } }
          : n,
      ),
    });
    const result = discardFeature(d, 'f');
    expect(result.ok && result.doc.models.map((m) => m.name)).toEqual(['WishDto', 'FavDto']);
  });
});

describe('conflicts and dependencies', () => {
  it('finds other open features changing or removing the same parts', () => {
    expect(featureConflicts(doc(), 'f')).toEqual([{ featureId: 'p', name: 'Profiles', items: [{ kind: 'node', id: 'users' }] }]);
    const shipped = CanvasDoc.parse({ ...doc(), features: doc().features.map((f) => (f.id === 'p' ? { ...f, status: 'shipped' } : f)) });
    expect(featureConflicts(shipped, 'f')).toEqual([]);
  });

  it('warns about them in the changeset', () => {
    const warnings = featureChanges(doc(), 'f')!.warnings;
    expect(warnings.filter((w) => w.code === 'conflict').map((w) => w.message)).toEqual(['Profiles also changes or removes users']);
    expect(warnings.filter((w) => w.code === 'dependency').map((w) => w.message)).toEqual(['Depends on Profiles, which is not shipped yet: bios']);
  });

  it('names parts of every kind', () => {
    expect(partName(doc(), { kind: 'edge', id: 'write' })).toBe('POST /wishlist → wishlist_items');
    expect(partName(doc(), { kind: 'model', id: 'wdto' })).toBe('WishDto');
    expect(partName(doc(), { kind: 'node', id: 'gone' })).toBe('?');
  });
});

describe('discarding a shipped feature', () => {
  it('is refused: its work is the project now', () => {
    const shipped = shipFeature(doc(), 'f');
    if (!shipped.ok) throw new Error(shipped.reason);
    expect(discardFeature(shipped.doc, 'f')).toMatchObject({ ok: false });
  });
});
