import { Parser } from '@dbml/core';
import { describe, expect, it } from 'vitest';
import {
  CanvasDoc,
  emptyCanvas,
  parseCanvasFile,
  parseDbml,
  parseSqlSchema,
  SQL_DIALECTS,
  toCanvasJson,
  toDbml,
  toSqlSchema,
  type ImportedSchema,
} from '../src';

const at = { x: 0, y: 0 };

/** Tables as `schema.table(col type [pk] [nn] [uq] [=default] [#note])` lines, refs as `a.b -> c.d (onDelete)` */
function summary(s: ImportedSchema) {
  return {
    tables: s.tables.map(
      (t) =>
        `${t.schema}.${t.name}(${t.columns
          .map((c) =>
            [
              c.name,
              c.type,
              c.primaryKey && 'pk',
              !c.nullable && !c.primaryKey && 'nn',
              c.unique && 'uq',
              c.default !== undefined && `=${c.default}`,
              c.note && `#${c.note}`,
            ]
              .filter(Boolean)
              .join(' '),
          )
          .join(', ')})${t.indexes.length ? ` idx[${t.indexes.map((ix) => `${ix.unique ? 'u:' : ''}${ix.columns.join('+')}`).join(' ')}]` : ''}${t.note ? ` #${t.note}` : ''}`,
    ),
    refs: s.refs.map(
      (r) =>
        `${r.from.table}.${r.from.columns.join('+')} -> ${r.to.table}.${r.to.columns.join('+') || '(pk)'} (${r.onDelete}${r.oneToOne ? ', 1:1' : ''})`,
    ),
  };
}

/** A doc to round-trip through the exports */
const doc = CanvasDoc.parse({
  ...emptyCanvas(),
  nodes: [
    {
      id: 'users',
      type: 'table',
      label: 'users',
      position: at,
      data: {
        columns: [
          { id: 'u1', name: 'id', type: 'bigserial', primaryKey: true },
          { id: 'u2', name: 'email', type: 'varchar(255)', nullable: false, unique: true, note: 'login name' },
          { id: 'u3', name: 'status', type: 'text', default: "'active'" },
          { id: 'u4', name: 'balance', type: 'numeric(10,2)', default: '0' },
        ],
        indexes: [{ id: 'ix', columnIds: ['u3', 'u4'] }],
      },
    },
    {
      id: 'orders',
      type: 'table',
      label: 'orders',
      position: at,
      data: {
        schema: 'shop',
        columns: [
          { id: 'o1', name: 'id', type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' },
          { id: 'o2', name: 'user_id', type: 'bigint', nullable: false },
          { id: 'o3', name: 'placed_at', type: 'timestamptz', default: 'now()' },
        ],
      },
    },
  ],
  edges: [{ id: 'fk', kind: 'fk', source: 'orders', target: 'users', data: { sourceColumnId: 'o2', targetColumnId: 'u1', onDelete: 'cascade' } }],
});

describe('parseSqlSchema', () => {
  it('reads back the PostgreSQL export exactly (column notes are not part of the SQL)', () => {
    const sql = toSqlSchema(doc);
    expect(summary(parseSqlSchema(sql, 'postgresql'))).toEqual({
      tables: [
        "public.users(id bigserial pk, email varchar(255) nn uq, status text ='active', balance numeric(10,2) =0) idx[status+balance]",
        'shop.orders(id uuid pk =gen_random_uuid(), user_id bigint nn, placed_at timestamptz =now())',
      ],
      refs: ['orders.user_id -> users.id (cascade)'],
    });
    expect(parseSqlSchema(sql).warnings).toEqual([]);
  });

  it.each(SQL_DIALECTS)('reads back the %s export: same tables, keys and references', (dialect) => {
    const parsed = parseSqlSchema(toSqlSchema(doc, { dialect }), dialect);
    expect(parsed.tables.map((t) => [t.name, t.columns.map((c) => [c.name, c.primaryKey, c.nullable, c.unique])])).toEqual([
      ['users', [['id', true, false, false], ['email', false, false, true], ['status', false, true, false], ['balance', false, true, false]]],
      [dialect === 'postgresql' ? 'orders' : 'shop_orders', [['id', true, false, false], ['user_id', false, false, false], ['placed_at', false, true, false]]],
    ]);
    expect(parsed.refs).toHaveLength(1);
    expect(parsed.refs[0]!.onDelete).toBe('cascade');
    if (dialect === 'mysql' || dialect === 'mariadb') expect(parsed.tables[0]!.columns[0]!.type).toMatch(/auto_increment$/);
  });

  it('reads hand-written PostgreSQL: quoting, table constraints, identity, comments, ALTER and CREATE INDEX', () => {
    const sql = `
      CREATE TYPE mood AS ENUM ('ok', 'sad');
      CREATE TABLE IF NOT EXISTS public."Customer" (
        id integer GENERATED ALWAYS AS IDENTITY,
        "full name" text NOT NULL,
        tags text[] DEFAULT '{}'::text[],
        price numeric(10, 2) CHECK (price >= 0),
        seen_at timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT customer_pk PRIMARY KEY (id),
        UNIQUE ("full name", seen_at)
      );
      CREATE TABLE orders (
        id serial PRIMARY KEY,
        customer_id integer REFERENCES "Customer" ON DELETE SET NULL,
        referrer_id integer,
        note text, -- free text
        amount integer -- in cents
      );
      CREATE VIEW v AS SELECT 1;
      CREATE UNIQUE INDEX IF NOT EXISTS orders_note ON ONLY orders USING btree (note DESC);
      CREATE INDEX lower_note ON orders (lower(note));
      ALTER TABLE ONLY orders ADD CONSTRAINT o_r FOREIGN KEY (referrer_id) REFERENCES public."Customer"(id) ON DELETE CASCADE DEFERRABLE;
      COMMENT ON TABLE orders IS 'Placed orders';
      COMMENT ON COLUMN public.orders.note IS 'Shown to staff';
    `;
    const parsed = parseSqlSchema(sql, 'postgresql');
    expect(summary(parsed)).toEqual({
      tables: [
        "public.Customer(id serial pk, full name text nn, tags text[] ='{}'::text[], price numeric(10,2), seen_at timestamp with time zone nn =now()) idx[u:full name+seen_at]",
        'public.orders(id serial pk, customer_id integer, referrer_id integer, note text #Shown to staff, amount integer #in cents) idx[u:note] #Placed orders',
      ],
      refs: ['orders.customer_id -> Customer.(pk) (set null)', 'orders.referrer_id -> Customer.id (cascade)'],
    });
    expect(parsed.warnings).toEqual([
      'Skipped index lower_note: expression indexes are not supported',
      "Skipped 2 statements that don't define tables (views, types, functions, ...)",
    ]);
    // @dbml/core reads the same tables and columns
    const db = new Parser().parse(sql.replace(/CREATE (TYPE|VIEW)[^;]*;/g, ''), 'postgres').export();
    const dbTables = db.schemas.flatMap((s) => s.tables.map((t) => `${t.name}(${t.fields.map((f) => f.name).join(',')})`));
    expect(dbTables.sort()).toEqual(parsed.tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(',')})`).sort());
  });

  it('reads hand-written MySQL: backticks, AUTO_INCREMENT, keys, comments and table options', () => {
    const sql = `
      SET NAMES utf8mb4;
      CREATE TABLE \`users\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`email\` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Login',
        \`updated_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`users_email\` (\`email\`),
        KEY \`by_update\` (\`updated_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE posts (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT UNSIGNED,
        FOREIGN KEY fk_user (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
      );`;
    const parsed = parseSqlSchema(sql, 'mysql');
    expect(summary(parsed)).toEqual({
      tables: [
        'public.users(id INT UNSIGNED auto_increment pk, email VARCHAR(191) nn uq #Login, updated_at TIMESTAMP =CURRENT_TIMESTAMP) idx[updated_at]',
        'public.posts(id INT auto_increment pk, user_id INT UNSIGNED)',
      ],
      refs: ['posts.user_id -> users.id (restrict)'],
    });
    expect(parsed.warnings).toEqual([]);
    const db = new Parser().parse(sql.replace(/SET NAMES[^;]*;/, ''), 'mysql').export();
    expect(db.schemas.flatMap((s) => s.tables.map((t) => t.name)).sort()).toEqual(['posts', 'users']);
  });

  it('reads SQLite: INTEGER PRIMARY KEY AUTOINCREMENT and inline references', () => {
    const parsed = parseSqlSchema(
      `PRAGMA foreign_keys = ON;
       CREATE TABLE a (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT 'x');
       CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER NOT NULL REFERENCES a(id) ON DELETE CASCADE) STRICT;`,
      'sqlite',
    );
    expect(summary(parsed)).toEqual({
      tables: ["public.a(id INTEGER pk, name TEXT nn ='x')", 'public.b(id INTEGER pk, a_id INTEGER nn)'],
      refs: ['b.a_id -> a.id (cascade)'],
    });
  });

  it('is lenient: garbage and unknown tables give warnings, not errors', () => {
    const parsed = parseSqlSchema('hello world; ALTER TABLE ghost ADD COLUMN x int; CREATE TABLE t AS SELECT 1;');
    expect(parsed.tables).toEqual([]);
    expect(parsed.warnings).toEqual([
      'ALTER TABLE on an unknown table ghost was skipped',
      'Skipped table t: no column list (CREATE TABLE ... AS / LIKE is not supported)',
      "Skipped 1 statement that don't define tables (views, types, functions, ...)",
    ]);
  });
});

describe('parseDbml', () => {
  it('reads back the DBML export', () => {
    const framed = CanvasDoc.parse({
      ...doc,
      nodes: [
        { id: 'f', type: 'frame', label: 'Core', position: at, size: { width: 400, height: 300 }, data: {} },
        ...doc.nodes.map((n) => (n.id === 'users' ? { ...n, parentId: 'f', notes: 'All customers' } : n)),
      ],
    });
    const parsed = parseDbml(toDbml(framed));
    expect(summary(parsed)).toEqual({
      tables: [
        "public.users(id bigserial pk, email varchar(255) nn uq #login name, status text ='active', balance numeric(10,2) =0) idx[status+balance] #All customers",
        'shop.orders(id uuid pk =gen_random_uuid(), user_id bigint nn, placed_at timestamptz =now())',
      ],
      refs: ['orders.user_id -> users.id (cascade)'],
    });
    expect(parsed.groups).toEqual([{ name: 'Core', tables: [{ schema: 'public', table: 'users' }] }]);
    expect(parsed.warnings).toEqual([]);
  });

  it('reads hand-written DBML: aliases, inline and block refs, composite keys, enums, notes and increment', () => {
    const dbml = `
      Project shop {
        database_type: 'PostgreSQL'
      }
      Enum order_status {
        draft
        paid [note: 'money received']
      }
      Table users as U [headercolor: #3498DB] {
        id integer [pk, increment]
        email "character varying" [not null, unique, note: 'Login']
        created_at timestamp [default: \`now()\`]
        Note: '''
          Everyone who can log in
        '''
      }
      Table orders {
        id int [pk]
        user_id int [ref: > U.id, not null]
        status order_status [default: 'draft']
        total "decimal(10,2)" [default: -1.5]
        indexes {
          (user_id, status) [unique, name: 'orders_user_status']
          \`lower(status)\`
        }
      }
      Table order_items {
        order_id int
        product_id int
        indexes {
          (order_id, product_id) [pk]
        }
      }
      Table products {
        id int [pk]
      }
      Ref: order_items.order_id > orders.id [delete: cascade]
      Ref items_products {
        products.id < order_items.product_id [delete: set null]
      }
      Ref: users.id - orders.id
      Ref: products.id <> orders.id
      TableGroup commerce {
        orders
        order_items
      }
    `;
    const parsed = parseDbml(dbml, 'postgresql');
    expect(summary(parsed)).toEqual({
      tables: [
        "public.users(id serial pk, email character varying nn uq #Login, created_at timestamp =now()) #Everyone who can log in",
        "public.orders(id int pk, user_id int nn, status order_status ='draft', total decimal(10,2) =-1.5) idx[u:user_id+status]",
        'public.order_items(order_id int pk, product_id int pk)',
        'public.products(id int pk)',
      ],
      refs: [
        'orders.user_id -> users.id (no action)',
        'order_items.order_id -> orders.id (cascade)',
        'order_items.product_id -> products.id (set null)',
        'users.id -> orders.id (no action, 1:1)',
      ],
    });
    expect(parsed.groups).toEqual([{ name: 'commerce', tables: [{ schema: 'public', table: 'orders' }, { schema: 'public', table: 'order_items' }] }]);
    expect(parsed.warnings).toEqual([
      'Skipped an expression index on orders',
      'Skipped the many-to-many ref between products and orders (add a join table)',
    ]);
    // @dbml/core agrees on the tables and columns
    const db = new Parser().parse(dbml, 'dbml').export();
    expect(db.schemas.flatMap((s) => s.tables.map((t) => `${t.name}(${t.fields.map((f) => f.name).join(',')})`))).toEqual(
      parsed.tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(',')})`),
    );
  });

  it('turns increment into the dialect’s auto-increment', () => {
    const dbml = 'Table t { id bigint [pk, increment] }';
    expect(parseDbml(dbml, 'mysql').tables[0]!.columns[0]!.type).toBe('bigint auto_increment');
    expect(parseDbml(dbml, 'postgresql').tables[0]!.columns[0]!.type).toBe('bigserial');
    expect(parseDbml(dbml, 'sqlite').tables[0]!.columns[0]!.type).toBe('bigint');
  });
});

describe('parseCanvasFile', () => {
  it('reads RuneArch files and bare documents', () => {
    expect(parseCanvasFile(toCanvasJson(doc))).toEqual({ ok: true, doc });
    expect(parseCanvasFile(JSON.stringify(doc))).toEqual({ ok: true, doc });
  });

  it('explains what is wrong', () => {
    expect(parseCanvasFile('{nope')).toMatchObject({ ok: false, error: expect.stringMatching(/^Not valid JSON/) });
    expect(parseCanvasFile(JSON.stringify({ ...doc, schemaVersion: 2 }))).toMatchObject({
      ok: false,
      error: 'This file is schema version 2; this app reads version 1',
    });
    const broken = { ...doc, edges: [{ id: 'x', kind: 'calls', source: 'users', target: 'ghost' }] };
    expect(parseCanvasFile(JSON.stringify(broken))).toEqual({
      ok: false,
      error: 'The file is not a valid RuneArch document',
      issues: ['edges.0: Edge references a missing node'],
    });
  });
});
