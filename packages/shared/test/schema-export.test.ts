import { Parser } from '@dbml/core';
import { describe, expect, it } from 'vitest';
import { CanvasDoc, emptyCanvas, schemaExportByExtension, SCHEMA_EXPORTS, toDbml, toMermaidEr, toSqlSchema } from '../src';

const parse = (input: Record<string, unknown>) => CanvasDoc.parse({ ...emptyCanvas(), ...input });
const at = { x: 0, y: 0 };

const users = {
  id: 'users',
  type: 'table',
  label: 'users',
  notes: 'People who\ncan sign in',
  position: at,
  data: {
    columns: [
      { id: 'u1', name: 'id', type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' },
      { id: 'u2', name: 'email', type: 'text', nullable: false, unique: true, note: "User's login" },
      { id: 'u3', name: 'status', type: 'varchar(20)', default: "'active'" },
      { id: 'u4', name: 'created at', type: 'timestamp with time zone', default: 'now()' },
      { id: 'u5', name: 'balance', type: 'numeric(10,2)', default: '0' },
    ],
    indexes: [{ id: 'i1', name: 'users_status', columnIds: ['u3', 'u5'] }],
  },
};

const orders = {
  id: 'orders',
  type: 'table',
  label: 'orders',
  parentId: 'shop',
  position: at,
  data: {
    schema: 'shop',
    columns: [
      { id: 'o1', name: 'id', type: 'bigserial', primaryKey: true },
      { id: 'o2', name: 'user_id', type: 'uuid', nullable: false },
      { id: 'o3', name: 'coupon_id', type: 'uuid' },
    ],
    indexes: [{ id: 'i2', columnIds: ['o2'], unique: true }],
  },
};

/** Composite primary key and a 1:1 link */
const profiles = {
  id: 'profiles',
  type: 'table',
  label: 'profiles',
  parentId: 'shop',
  position: at,
  data: {
    columns: [
      { id: 'p1', name: 'user_id', type: 'uuid', primaryKey: true },
      { id: 'p2', name: 'locale', type: 'text', primaryKey: true },
    ],
  },
};

const coupons = { id: 'coupons', type: 'table', label: 'coupons', position: at, data: { columns: [{ id: 'c1', name: 'id', type: 'uuid', primaryKey: true }] } };

const frame = { id: 'shop', type: 'frame', label: 'Shop', position: at, data: {} };

const fk = (id: string, source: string, target: string, data: Record<string, unknown>) => ({ id, kind: 'fk', source, target, data });

const doc = parse({
  nodes: [frame, users, orders, profiles, coupons],
  edges: [
    fk('f1', 'orders', 'users', { sourceColumnId: 'o2', targetColumnId: 'u1', onDelete: 'cascade' }),
    fk('f2', 'orders', 'coupons', { sourceColumnId: 'o3', targetColumnId: 'c1', onDelete: 'set null' }),
    fk('f3', 'profiles', 'users', { sourceColumnId: 'p1', targetColumnId: 'u1', cardinality: '1:1' }),
  ],
});

describe('toDbml', () => {
  const dbml = toDbml(doc);

  it('renders tables with column settings, indexes and notes', () => {
    expect(dbml).toContain(
      [
        'Table users {',
        '  id uuid [pk, default: `gen_random_uuid()`]',
        "  email text [not null, unique, note: 'User\\'s login']",
        "  status varchar(20) [default: 'active']",
        '  "created at" "timestamp with time zone" [default: `now()`]',
        '  balance numeric(10,2) [default: 0]',
        '',
        '  indexes {',
        "    (status, balance) [name: 'users_status']",
        '  }',
        '',
        "  Note: '''",
        'People who',
        'can sign in',
        "'''",
        '}',
      ].join('\n'),
    );
  });

  it('renders schemas, composite keys, refs and frames as table groups', () => {
    expect(dbml).toContain('Table shop.orders {\n  id bigserial [pk]\n  user_id uuid [not null]\n  coupon_id uuid\n');
    expect(dbml).toContain('  indexes {\n    user_id [unique]\n  }');
    expect(dbml).toContain('  user_id uuid [not null]\n  locale text [not null]\n\n  indexes {\n    (user_id, locale) [pk]\n  }');
    expect(dbml).toContain(
      [
        'Ref: shop.orders.user_id > users.id [delete: cascade]',
        'Ref: shop.orders.coupon_id > coupons.id [delete: set null]',
        'Ref: profiles.user_id - users.id',
      ].join('\n'),
    );
    expect(dbml).toContain('TableGroup Shop {\n  shop.orders\n  profiles\n}');
  });

  it('is valid DBML', () => {
    const database = new Parser().parse(dbml, 'dbml').export();
    const tables = database.schemas.flatMap((s) => s.tables.map((t) => `${s.name}.${t.name}`));
    expect(tables.sort()).toEqual(['public.coupons', 'public.profiles', 'public.users', 'shop.orders']);
    expect(database.schemas.flatMap((s) => s.refs)).toHaveLength(3);
  });

  it('renders an empty doc as just the header', () => {
    expect(toDbml(emptyCanvas()).trim().split('\n')).toHaveLength(1);
  });
});

describe('toMermaidEr', () => {
  const er = toMermaidEr(doc);

  it('renders entities with keys and comments, keeping unsupported names and types in the comment', () => {
    expect(er).toContain(
      [
        '  %% users: People who can sign in',
        '  users {',
        '    uuid id PK "default: gen_random_uuid()"',
        `    text email UK "not null; User's login"`,
        `    varchar(20) status "default: 'active'"`,
        '    timestamp_with_time_zone created_at "name: created at; type: timestamp with time zone; default: now()"',
        '    numeric(10_2) balance "type: numeric(10,2); default: 0"',
        '  }',
      ].join('\n'),
    );
    expect(er).toContain('  "shop.orders" {\n    bigserial id PK\n    uuid user_id FK "not null"\n    uuid coupon_id FK\n  }');
    expect(er).toContain('    uuid user_id PK, FK\n');
  });

  it('derives relationship cardinality from the FK and its column', () => {
    expect(er).toContain('  users ||--o{ "shop.orders" : "user_id"');
    expect(er).toContain('  coupons |o--o{ "shop.orders" : "coupon_id"');
    expect(er).toContain('  users ||--o| profiles : "user_id"');
  });
});

describe('toSqlSchema', () => {
  const sql = toSqlSchema(doc);

  it('creates schemas first and adds foreign keys after every table', () => {
    expect(sql.indexOf('CREATE SCHEMA IF NOT EXISTS shop;')).toBeLessThan(sql.indexOf('CREATE TABLE'));
    expect(sql).not.toContain('  FOREIGN KEY');
    expect(sql.indexOf('ALTER TABLE')).toBeGreaterThan(sql.lastIndexOf('CREATE TABLE'));
    expect(sql).toContain('ALTER TABLE shop.orders ADD FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;');
    expect(sql).toContain('ALTER TABLE profiles ADD FOREIGN KEY (user_id) REFERENCES users (id);');
  });

  it('is valid PostgreSQL', () => {
    const database = new Parser().parse(sql, 'postgres').export();
    expect(database.schemas.flatMap((s) => s.tables)).toHaveLength(4);
    expect(database.schemas.flatMap((s) => s.refs)).toHaveLength(3);
  });
});

describe('SCHEMA_EXPORTS', () => {
  it('looks formats up by extension', () => {
    expect(schemaExportByExtension('dbml')).toBe(SCHEMA_EXPORTS.dbml);
    expect(schemaExportByExtension('mmd')).toBe(SCHEMA_EXPORTS.mermaid);
    expect(schemaExportByExtension('sql')).toBe(SCHEMA_EXPORTS.sql);
    expect(schemaExportByExtension('json')).toBeUndefined();
  });
});
