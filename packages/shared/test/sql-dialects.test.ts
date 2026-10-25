import { Parser } from '@dbml/core';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  CanvasDoc,
  convertDocDialect,
  emptyCanvas,
  SQL_DIALECTS,
  sqlIdent,
  sqlTableName,
  tableToDdl,
  toSqlSchema,
  translateDefault,
  translateType,
  type SqlDialect,
  type TableNode,
} from '../src';

const at = { x: 0, y: 0 };
const fk = (id: string, source: string, target: string, data: Record<string, unknown>) => ({ id, kind: 'fk', source, target, data });

/** Designed in PostgreSQL: reserved names, a schema, arrays, jsonb, casts, a self reference */
const pgDoc = CanvasDoc.parse({
  ...emptyCanvas(),
  nodes: [
    {
      id: 'user',
      type: 'table',
      label: 'user',
      position: at,
      data: {
        columns: [
          { id: 'u1', name: 'id', type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' },
          { id: 'u2', name: 'email', type: 'text', nullable: false, unique: true },
          { id: 'u3', name: 'status', type: 'varchar(20)', default: "'active'::character varying" },
          { id: 'u4', name: 'createdAt', type: 'timestamp with time zone', default: 'now()' },
          { id: 'u5', name: 'balance', type: 'numeric(10,2)', default: '0' },
          { id: 'u6', name: 'active', type: 'boolean', default: 'true' },
          { id: 'u7', name: 'profile', type: 'jsonb', default: "'{}'" },
          { id: 'u8', name: 'bio', type: 'text', default: "''" },
        ],
        indexes: [{ id: 'i1', name: 'user_status', columnIds: ['u3', 'u5'] }],
      },
    },
    {
      id: 'order',
      type: 'table',
      label: 'order',
      position: at,
      data: {
        schema: 'shop',
        columns: [
          { id: 'o1', name: 'id', type: 'bigserial', primaryKey: true },
          { id: 'o2', name: 'user_id', type: 'uuid', nullable: false },
          { id: 'o3', name: 'tags', type: 'text[]' },
          { id: 'o4', name: 'placed_on', type: 'date', default: 'current_date' },
          { id: 'o5', name: 'parent_id', type: 'bigint' },
        ],
      },
    },
    {
      id: 'links',
      type: 'table',
      label: 'order_links',
      position: at,
      data: {
        columns: [
          { id: 'l1', name: 'a', type: 'bigint', primaryKey: true },
          { id: 'l2', name: 'b', type: 'bigint', primaryKey: true },
        ],
      },
    },
  ],
  edges: [
    fk('f1', 'order', 'user', { sourceColumnId: 'o2', targetColumnId: 'u1', onDelete: 'cascade' }),
    fk('f2', 'order', 'order', { sourceColumnId: 'o5', targetColumnId: 'o1', onDelete: 'set null' }),
    fk('f3', 'links', 'order', { sourceColumnId: 'l1', targetColumnId: 'o1' }),
  ],
});

/** Designed in MySQL: auto_increment, unsigned, tinyint(1), datetime, parenthesized defaults */
const mysqlDoc = CanvasDoc.parse({
  ...emptyCanvas(),
  database: { dialect: 'mysql' },
  nodes: [
    {
      id: 'a',
      type: 'table',
      label: 'accounts',
      position: at,
      data: {
        columns: [
          { id: 'a1', name: 'id', type: 'int auto_increment', primaryKey: true },
          { id: 'a2', name: 'ext_id', type: 'char(36)', default: '(uuid())', unique: true },
          { id: 'a3', name: 'is_admin', type: 'tinyint(1)', default: '0' },
          { id: 'a4', name: 'created', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { id: 'a5', name: 'seen', type: 'datetime' },
          { id: 'a6', name: 'body', type: 'longtext' },
        ],
      },
    },
    {
      id: 'b',
      type: 'table',
      label: 'posts',
      position: at,
      data: {
        columns: [
          { id: 'b1', name: 'id', type: 'bigint unsigned auto_increment', primaryKey: true },
          { id: 'b2', name: 'account_id', type: 'int', nullable: false },
        ],
      },
    },
  ],
  edges: [fk('f', 'b', 'a', { sourceColumnId: 'b2', targetColumnId: 'a1' })],
});

const table = (doc: CanvasDoc, id: string) => doc.nodes.find((n) => n.id === id) as TableNode;

describe('identifiers', () => {
  it('quotes reserved and non-plain names per dialect', () => {
    expect(sqlIdent('order')).toBe('"order"');
    expect(sqlIdent('order', 'mysql')).toBe('`order`');
    expect(sqlIdent('a`b', 'mariadb')).toBe('`a``b`');
    expect(sqlIdent('user_id', 'sqlite')).toBe('user_id');
  });

  it('prefixes schemas where there are none', () => {
    const order = table(pgDoc, 'order');
    expect(sqlTableName(order, 'postgresql')).toBe('shop."order"');
    expect(sqlTableName(order, 'mysql')).toBe('shop_order');
    expect(sqlTableName(order, 'sqlite')).toBe('shop_order');
  });
});

describe('translateType', () => {
  const to = (raw: string, dialect: SqlDialect, from: SqlDialect = 'postgresql', indexed = false) =>
    translateType(raw, { from, to: dialect }, { indexed });

  it('keeps types as written in the project dialect', () => {
    expect(to('timestamp', 'mysql', 'mysql')).toEqual({ type: 'timestamp', autoIncrement: false });
    expect(to('citext', 'postgresql')).toEqual({ type: 'citext', autoIncrement: false });
  });

  it.each([
    ['uuid', 'mysql', 'char(36)'],
    ['uuid', 'mariadb', 'uuid'],
    ['uuid', 'sqlite', 'text'],
    ['timestamptz', 'mysql', 'timestamp'],
    ['timestamp(3)', 'mysql', 'datetime(3)'],
    ['jsonb', 'mariadb', 'json'],
    ['boolean', 'sqlite', 'integer'],
    ['double precision', 'mysql', 'double'],
    ['float', 'mysql', 'double'],
    ['bytea', 'mysql', 'longblob'],
    ['varchar', 'mysql', 'varchar(255)'],
    ['numeric(12,2)', 'mysql', 'decimal(12,2)'],
    ['inet', 'mysql', 'inet'],
  ] as const)('%s → %s: %s', (raw, dialect, type) => {
    expect(to(raw, dialect).type).toBe(type);
  });

  it.each([
    ['tinyint(1)', 'boolean'],
    ['datetime', 'timestamp'],
    ['timestamp', 'timestamptz'],
    ['double', 'double precision'],
    ['longtext', 'text'],
    ['bigint unsigned', 'bigint'],
  ] as const)('MySQL %s → PostgreSQL %s', (raw, type) => {
    expect(to(raw, 'postgresql', 'mysql').type).toBe(type);
  });

  it('maps auto-increment types', () => {
    expect(to('bigserial', 'mysql')).toEqual({ type: 'bigint', autoIncrement: true });
    expect(to('serial', 'sqlite')).toEqual({ type: 'integer', autoIncrement: true });
    expect(to('int auto_increment', 'postgresql', 'mysql')).toEqual({ type: 'serial', autoIncrement: true });
    expect(to('bigint unsigned auto_increment', 'postgresql', 'mariadb')).toEqual({ type: 'bigserial', autoIncrement: true });
  });

  it('makes indexed text indexable in MySQL and notes lost arrays', () => {
    expect(to('text', 'mysql', 'postgresql', true).type).toBe('varchar(255)');
    expect(to('text', 'mysql').type).toBe('text');
    expect(to('text[]', 'mysql')).toEqual({ type: 'json', autoIncrement: false, note: 'text[]: MySQL has no arrays' });
    expect(to('int[]', 'postgresql', 'postgresql').type).toBe('int[]');
  });
});

describe('translateDefault', () => {
  const to = (value: string, dialect: SqlDialect, type = 'varchar(20)', from: SqlDialect = 'postgresql') =>
    translateDefault(value, { from, to: dialect }, type);

  it.each([
    ['gen_random_uuid()', 'mysql', '(uuid())'],
    ['gen_random_uuid()', 'mariadb', 'uuid()'],
    ['gen_random_uuid()', 'sqlite', '(lower(hex(randomblob(16))))'],
    ['now()', 'mysql', 'CURRENT_TIMESTAMP'],
    ['current_date', 'mysql', '(CURRENT_DATE)'],
    ['true', 'sqlite', '1'],
    ["'active'::character varying", 'mysql', "'active'"],
    ['lower(x)', 'sqlite', '(lower(x))'],
  ] as const)('%s → %s: %s', (value, dialect, expected) => {
    expect(to(value, dialect)).toBe(expected);
  });

  it('parenthesizes literal defaults on MySQL text and json columns', () => {
    expect(to("''", 'mysql', 'text')).toBe("('')");
    expect(to("'{}'", 'mysql', 'json')).toBe("('{}')");
    expect(to("''", 'mariadb', 'text')).toBe("''");
  });

  it('translates MySQL defaults to PostgreSQL', () => {
    expect(to('(uuid())', 'postgresql', 'char(36)', 'mysql')).toBe('gen_random_uuid()');
    expect(to('CURRENT_TIMESTAMP', 'postgresql', 'timestamptz', 'mysql')).toBe('now()');
    expect(to('0', 'postgresql', 'boolean', 'mysql')).toBe('FALSE');
    expect(to('(a) + (b)', 'postgresql', 'integer', 'mysql')).toBe('(a) + (b)');
  });
});

describe('toSqlSchema by dialect', () => {
  it('uses the doc dialect by default', () => {
    expect(toSqlSchema(mysqlDoc)).toContain('-- Generated by RuneArch for MySQL 8.0.13+');
    expect(toSqlSchema(mysqlDoc)).toContain('  id int auto_increment PRIMARY KEY,');
    expect(toSqlSchema(pgDoc)).toBe(toSqlSchema(pgDoc, { dialect: 'postgresql' }));
  });

  it('renders MySQL', () => {
    expect(toSqlSchema(pgDoc, { dialect: 'mysql' })).toBe(
      [
        '-- Generated by RuneArch for MySQL 8.0.13+',
        '-- MySQL has no schemas: tables in shop are named <schema>_<table>',
        '',
        'CREATE TABLE `user` (',
        '  id char(36) PRIMARY KEY DEFAULT (uuid()),',
        '  email varchar(255) NOT NULL UNIQUE,',
        "  status varchar(20) DEFAULT 'active',",
        '  `createdAt` timestamp DEFAULT CURRENT_TIMESTAMP,',
        '  balance decimal(10,2) DEFAULT 0,',
        '  active boolean DEFAULT TRUE,',
        "  profile json DEFAULT ('{}'),",
        "  bio text DEFAULT ('')",
        ');',
        '',
        'CREATE INDEX user_status ON `user` (status, balance);',
        '',
        'CREATE TABLE shop_order (',
        '  id bigint AUTO_INCREMENT PRIMARY KEY,',
        '  user_id char(36) NOT NULL,',
        '  tags json, -- text[]: MySQL has no arrays',
        '  placed_on date DEFAULT (CURRENT_DATE),',
        '  parent_id bigint',
        ');',
        '',
        'CREATE TABLE order_links (',
        '  a bigint NOT NULL,',
        '  b bigint NOT NULL,',
        '  PRIMARY KEY (a, b)',
        ');',
        '',
        'ALTER TABLE shop_order ADD FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE;',
        '',
        'ALTER TABLE shop_order ADD FOREIGN KEY (parent_id) REFERENCES shop_order (id) ON DELETE SET NULL;',
        '',
        'ALTER TABLE order_links ADD FOREIGN KEY (a) REFERENCES shop_order (id);',
        '',
      ].join('\n'),
    );
  });

  it('renders SQLite with inline foreign keys', () => {
    const sql = toSqlSchema(pgDoc, { dialect: 'sqlite' });
    expect(sql).toContain('PRAGMA foreign_keys = ON;');
    expect(sql).not.toContain('ALTER TABLE');
    expect(sql).toContain(
      [
        'CREATE TABLE shop_order (',
        '  id integer PRIMARY KEY AUTOINCREMENT,',
        '  user_id text NOT NULL,',
        '  tags text, -- text[]: SQLite has no arrays',
        '  placed_on text DEFAULT CURRENT_DATE,',
        '  parent_id integer,',
        '  FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE,',
        '  FOREIGN KEY (parent_id) REFERENCES shop_order (id) ON DELETE SET NULL',
        ');',
      ].join('\n'),
    );
  });

  it('renders PostgreSQL from a MySQL design', () => {
    expect(tableToDdl(table(mysqlDoc, 'a'), mysqlDoc, { dialect: 'postgresql' })).toBe(
      [
        'CREATE TABLE accounts (',
        '  id serial PRIMARY KEY,',
        '  ext_id char(36) UNIQUE DEFAULT gen_random_uuid(),',
        '  is_admin boolean DEFAULT FALSE,',
        '  created timestamptz DEFAULT now(),',
        '  seen timestamp,',
        '  body text',
        ');',
      ].join('\n'),
    );
  });

  it.each([pgDoc, mysqlDoc])('runs on SQLite (doc %#)', (doc) => {
    const db = new DatabaseSync(':memory:');
    db.exec(toSqlSchema(doc, { dialect: 'sqlite' }));
    const tables = db.prepare("select count(*) as n from sqlite_master where type = 'table' and name <> 'sqlite_sequence'").get();
    expect(tables).toEqual({ n: doc.nodes.length });
    expect(db.prepare('pragma foreign_key_check').all()).toEqual([]);
  });

  it.each([pgDoc, mysqlDoc])('is valid MySQL (doc %#)', (doc) => {
    const database = new Parser().parse(toSqlSchema(doc, { dialect: 'mysql' }), 'mysql').export();
    expect(database.schemas.flatMap((s) => s.tables)).toHaveLength(doc.nodes.length);
  });

  it('covers every dialect', () => {
    for (const dialect of SQL_DIALECTS) expect(toSqlSchema(pgDoc, { dialect })).toMatch(/^-- Generated by RuneArch/);
  });
});

describe('convertDocDialect', () => {
  it('converts column types and defaults, keeping the doc valid', () => {
    const mysql = convertDocDialect(pgDoc, 'mysql');
    expect(mysql.database.dialect).toBe('mysql');
    expect(table(mysql, 'user').data.columns.map((c) => [c.type, c.default])).toEqual([
      ['char(36)', '(uuid())'],
      ['varchar(255)', undefined],
      ['varchar(20)', "'active'"],
      ['timestamp', 'CURRENT_TIMESTAMP'],
      ['decimal(10,2)', '0'],
      ['boolean', 'TRUE'],
      ['json', "('{}')"],
      ['text', "('')"],
    ]);
    expect(table(mysql, 'order').data.columns[0]!.type).toBe('bigint auto_increment');
    expect(CanvasDoc.safeParse(mysql).success).toBe(true);
  });

  it('renders the same SQL as translating on export', () => {
    // Up to keyword case, comments on lost types (the note keeps those) and SQLite's AUTOINCREMENT:
    // a stored `integer` primary key is still auto-assigned (it aliases the rowid)
    const normalize = (sql: string) => sql.replace(/ -- .*$/gm, '').replace(/ autoincrement/gi, '').toLowerCase();
    for (const dialect of SQL_DIALECTS) {
      expect(normalize(toSqlSchema(convertDocDialect(pgDoc, dialect)))).toBe(normalize(toSqlSchema(pgDoc, { dialect })));
    }
    expect(table(convertDocDialect(pgDoc, 'sqlite'), 'order').data.columns[2]).toMatchObject({
      type: 'text',
      note: 'text[]: SQLite has no arrays',
    });
  });

  it('round-trips through SQLite and back to a runnable script', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(toSqlSchema(convertDocDialect(convertDocDialect(mysqlDoc, 'postgresql'), 'sqlite')));
    expect(db.prepare("select count(*) as n from sqlite_master where type = 'table' and name <> 'sqlite_sequence'").get()).toEqual({ n: 2 });
  });

  it('returns the doc itself when the dialect is unchanged', () => {
    expect(convertDocDialect(pgDoc, 'postgresql')).toBe(pgDoc);
  });
});
