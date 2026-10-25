import { CanvasDoc, parseDbml, parseSqlSchema, type TableNode } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { shopDoc } from '../test/fixtures';
import { buildSchemaImport, importSchema } from './importOps';

const tables = (doc: CanvasDoc) => doc.nodes.filter((n): n is TableNode => n.type === 'table');
const table = (doc: CanvasDoc, label: string) => tables(doc).find((t) => t.label === label)!;
const fks = (doc: CanvasDoc) =>
  doc.edges.flatMap((e) => {
    if (e.kind !== 'fk') return [];
    const s = doc.nodes.find((n) => n.id === e.source) as TableNode;
    const t = doc.nodes.find((n) => n.id === e.target) as TableNode;
    const col = (tn: TableNode, id: string) => tn.data.columns.find((c) => c.id === id)?.name;
    return [`${s.label}.${col(s, e.data.sourceColumnId)} -> ${t.label}.${col(t, e.data.targetColumnId)} ${e.data.cardinality} ${e.data.onDelete}`];
  });

describe('buildSchemaImport', () => {
  it('adds new tables and FKs, including FKs to tables already on the canvas', () => {
    const doc = shopDoc(); // users(id, email), orders(id, user_id -> users.id)
    const schema = parseSqlSchema(`
      CREATE TABLE payments (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders ON DELETE CASCADE);
      CREATE TABLE refunds (id uuid PRIMARY KEY, payment_id uuid UNIQUE REFERENCES payments(id));`);
    const { doc: next, added, updated, refs, warnings } = buildSchemaImport(doc, schema);
    expect(added).toHaveLength(2);
    expect(updated).toEqual([]);
    expect(refs).toBe(2);
    expect(warnings).toEqual([]);
    expect(fks(next)).toEqual([
      'orders.user_id -> users.id n:1 no action',
      'payments.order_id -> orders.id n:1 cascade',
      'refunds.payment_id -> payments.id 1:1 no action',
    ]);
    expect(() => CanvasDoc.parse(next)).not.toThrow();
  });

  it('updates an existing table in place: column ids kept by name, lost columns take their FKs and flow steps', () => {
    const doc = shopDoc();
    const before = table(doc, 'orders');
    // orders loses user_id (and so its FK, and the flow step... here the flow uses the writes edge, which stays)
    const schema = parseSqlSchema('CREATE TABLE orders (id uuid PRIMARY KEY, total numeric(10,2) NOT NULL DEFAULT 0);');
    const { doc: next, added, updated } = buildSchemaImport(doc, schema);
    expect(added).toEqual([]);
    expect(updated).toEqual([before.id]);
    const after = table(next, 'orders');
    expect(after.position).toEqual(before.position);
    expect(after.data.columns.map((c) => [c.id === before.data.columns[0]!.id, c.name, c.type])).toEqual([
      [true, 'id', 'uuid'],
      [false, 'total', 'numeric(10,2)'],
    ]);
    expect(fks(next)).toEqual([]);
    expect(next.edges.map((e) => e.id)).toEqual(['w']);
    expect(() => CanvasDoc.parse(next)).not.toThrow();
  });

  it('converts types written for another database into the project dialect', () => {
    const doc = shopDoc(); // PostgreSQL
    const schema = parseSqlSchema('CREATE TABLE logs (id INT PRIMARY KEY AUTO_INCREMENT, at DATETIME);', 'mysql');
    const { doc: next } = buildSchemaImport(doc, schema, 'mysql');
    expect(table(next, 'logs').data.columns.map((c) => c.type)).toEqual(['serial', 'timestamp']);
  });

  it('warns about references it cannot resolve', () => {
    const schema = parseSqlSchema('CREATE TABLE a (id int PRIMARY KEY, x int REFERENCES ghost(id));');
    expect(buildSchemaImport(shopDoc(), schema).warnings).toEqual(['Skipped a foreign key from a to ghost: table not found']);
  });
});

describe('importSchema', () => {
  it('lays new tables out right of the canvas by their FKs and puts DBML table groups in frames', async () => {
    const doc = shopDoc(); // content spans x 0..~600
    const schema = parseDbml(`
      Table carts {
        id int [pk]
      }
      Table cart_items {
        id int [pk]
        cart_id int [ref: > carts.id]
      }
      TableGroup Basket {
        carts
        cart_items
      }`);
    const { doc: next, added } = await importSchema(doc, schema);
    const [carts, items] = [table(next, 'carts'), table(next, 'cart_items')];
    const frame = next.nodes.find((n) => n.type === 'frame')!;
    expect(frame.label).toBe('Basket');
    expect([carts.parentId, items.parentId]).toEqual([frame.id, frame.id]);
    expect(added).toEqual([carts.id, items.id]);
    // Right of the existing tables; FK edges run from the referencing table, so it comes first (as with Shift+L)
    expect(frame.position.x).toBeGreaterThan(600);
    expect(items.position.x).toBeLessThan(carts.position.x);
    expect(() => CanvasDoc.parse(next)).not.toThrow();
  });
});
