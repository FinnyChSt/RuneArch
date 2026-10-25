import { CanvasDoc, type TableNode } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { shopDoc } from '../test/fixtures';
import { applyTableEdit, duplicate, type ColumnRef } from './docOps';

const table = (doc: CanvasDoc, id: string) => doc.nodes.find((n) => n.id === id) as TableNode;
const refsOf = (t: TableNode, overrides: Record<string, ColumnRef['target']> = {}): ColumnRef[] =>
  t.data.columns.map((c) => ({
    columnId: c.id,
    target: c.id in overrides ? overrides[c.id]! : c.id === 'o_user' ? { tableId: 'users', columnId: 'u_id' } : null,
    onDelete: 'no action',
  }));

describe('applyTableEdit', () => {
  it('keeps FK edges when a column is renamed', () => {
    const doc = shopDoc();
    const orders = table(doc, 'orders');
    const renamed = {
      ...orders,
      data: { ...orders.data, columns: orders.data.columns.map((c) => (c.id === 'o_user' ? { ...c, name: 'customer_id' } : c)) },
    };
    const next = applyTableEdit(doc, renamed, refsOf(renamed));
    expect(next.edges.find((e) => e.id === 'fk')).toEqual(doc.edges.find((e) => e.id === 'fk'));
    expect(table(next, 'orders').data.columns[1]!.name).toBe('customer_id');
    expect(() => CanvasDoc.parse(next)).not.toThrow();
  });

  it('drops FK edges (in and out) of removed columns', () => {
    const doc = shopDoc();
    const users = table(doc, 'users');
    const withoutId = { ...users, data: { ...users.data, columns: users.data.columns.filter((c) => c.id !== 'u_id') } };
    const next = applyTableEdit(doc, withoutId, refsOf(withoutId));
    expect(next.edges.map((e) => e.id)).toEqual(['w']);
    expect(() => CanvasDoc.parse(next)).not.toThrow();
  });

  it('creates, retargets and removes FKs from column refs', () => {
    const doc = shopDoc();
    const orders = table(doc, 'orders');

    const retargeted = applyTableEdit(doc, orders, [
      ...refsOf(orders, { o_user: { tableId: 'users', columnId: 'u_email' } }),
    ]);
    const fk = retargeted.edges.find((e) => e.id === 'fk');
    expect(fk).toMatchObject({ target: 'users', data: { targetColumnId: 'u_email' } });

    const selfRef = applyTableEdit(doc, orders, refsOf(orders, { o_id: { tableId: 'orders', columnId: 'o_user' } }));
    expect(selfRef.edges.filter((e) => e.kind === 'fk')).toHaveLength(2);

    const cleared = applyTableEdit(doc, orders, refsOf(orders, { o_user: null }));
    expect(cleared.edges.map((e) => e.id)).toEqual(['w']);
  });

  it('returns the same edges when refs did not change', () => {
    const doc = shopDoc();
    const orders = table(doc, 'orders');
    expect(applyTableEdit(doc, orders, refsOf(orders)).edges).toBe(doc.edges);
  });
});

describe('duplicate', () => {
  it('copies FK edges between duplicated tables onto the new columns', () => {
    const doc = shopDoc();
    const result = duplicate(doc, ['users', 'orders']);
    const [usersCopy, ordersCopy] = result.doc.nodes.slice(-2) as TableNode[];
    const fkCopy = result.doc.edges.at(-1)!;
    expect(fkCopy).toMatchObject({
      kind: 'fk',
      source: ordersCopy!.id,
      target: usersCopy!.id,
      data: { sourceColumnId: ordersCopy!.data.columns[1]!.id, targetColumnId: usersCopy!.data.columns[0]!.id },
    });
    expect([usersCopy!.label, ordersCopy!.label]).toEqual(['users_2', 'orders_2']);
    expect(() => CanvasDoc.parse(result.doc)).not.toThrow();
  });
});
