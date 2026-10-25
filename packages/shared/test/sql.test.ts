import { describe, expect, it } from 'vitest';
import { CanvasDoc, emptyCanvas, sqlIdent, tableToDdl, type TableNode } from '../src';

const parse = (input: Record<string, unknown>) => CanvasDoc.parse({ ...emptyCanvas(), ...input });

const users = {
  id: 'users',
  type: 'table',
  label: 'users',
  position: { x: 0, y: 0 },
  data: {
    columns: [
      { id: 'u1', name: 'id', type: 'uuid', primaryKey: true, nullable: false, default: 'gen_random_uuid()' },
      { id: 'u2', name: 'email', type: 'text', nullable: false, unique: true },
      { id: 'u3', name: 'displayName', type: 'varchar(80)' },
    ],
    indexes: [{ id: 'i1', columnIds: ['u3'] }],
  },
};

const orders = {
  id: 'orders',
  type: 'table',
  label: 'orders',
  position: { x: 0, y: 0 },
  data: {
    schema: 'shop',
    columns: [
      { id: 'o1', name: 'id', type: 'bigserial', primaryKey: true },
      { id: 'o2', name: 'user_id', type: 'uuid', nullable: false },
    ],
    indexes: [{ id: 'i2', name: 'orders_user', columnIds: ['o2'], unique: true }],
  },
};

const fk = {
  id: 'fk',
  kind: 'fk',
  source: 'orders',
  target: 'users',
  data: { sourceColumnId: 'o2', targetColumnId: 'u1', onDelete: 'cascade' },
};

const table = (doc: CanvasDoc, id: string) => doc.nodes.find((n) => n.id === id) as TableNode;

describe('tableToDdl', () => {
  const doc = parse({ nodes: [users, orders], edges: [fk] });

  it('renders columns, constraints, defaults and indexes', () => {
    expect(tableToDdl(table(doc, 'users'), doc)).toBe(
      [
        'CREATE TABLE users (',
        '  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  email text NOT NULL UNIQUE,',
        '  "displayName" varchar(80)',
        ');',
        '',
        'CREATE INDEX "users_displayName_idx" ON users ("displayName");',
      ].join('\n'),
    );
  });

  it('renders schemas and foreign keys from fk edges', () => {
    expect(tableToDdl(table(doc, 'orders'), doc)).toBe(
      [
        'CREATE TABLE shop.orders (',
        '  id bigserial PRIMARY KEY,',
        '  user_id uuid NOT NULL,',
        '  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE',
        ');',
        '',
        'CREATE UNIQUE INDEX orders_user ON shop.orders (user_id);',
      ].join('\n'),
    );
  });

  it('uses a table-level primary key for composite keys', () => {
    const link = {
      ...orders,
      id: 'l',
      label: 'order_items',
      data: {
        columns: [
          { id: 'a', name: 'order_id', type: 'bigint', primaryKey: true },
          { id: 'b', name: 'item_id', type: 'bigint', primaryKey: true },
        ],
      },
    };
    const d = parse({ nodes: [link] });
    expect(tableToDdl(table(d, 'l'), d)).toBe(
      [
        'CREATE TABLE order_items (',
        '  order_id bigint NOT NULL,',
        '  item_id bigint NOT NULL,',
        '  PRIMARY KEY (order_id, item_id)',
        ');',
      ].join('\n'),
    );
  });

  it('quotes identifiers only when needed', () => {
    expect(sqlIdent('user_id')).toBe('user_id');
    expect(sqlIdent('User')).toBe('"User"');
    expect(sqlIdent('a"b')).toBe('"a""b"');
  });
});
