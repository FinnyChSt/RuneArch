import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { beforeFeature, CanvasDoc, emptyCanvas, featureMigration, toSqlSchema } from '../src';

const pos = { x: 0, y: 0 };
const col = (id: string, name: string, type: string, extra: object = {}) => ({ id, name, type, ...extra });

const usersBase = {
  id: 'users',
  type: 'table',
  label: 'users',
  position: pos,
  data: {
    columns: [col('u_id', 'id', 'integer', { primaryKey: true, nullable: false }), col('u_email', 'email', 'text'), col('u_nick', 'nickname', 'text')],
    indexes: [{ id: 'ix_email', columnIds: ['u_email'] }],
  },
};

/**
 * Wishlist: changes users (email retyped and unique, nickname dropped, wish_count added, new index),
 * adds wishlist_items with FKs to users and products, adds an FK from orders to users, and removes
 * legacy_favs. products and orders exist already.
 */
function shopDoc(dialect: 'postgresql' | 'sqlite' | 'mysql' = 'sqlite') {
  return CanvasDoc.parse({
    ...emptyCanvas(),
    database: { dialect },
    nodes: [
      {
        ...usersBase,
        data: {
          columns: [
            col('u_id', 'id', 'integer', { primaryKey: true, nullable: false }),
            col('u_email', 'email', 'varchar(320)', { unique: true }),
            col('u_wish', 'wish_count', 'integer', { nullable: false, default: '0' }),
          ],
          indexes: [{ id: 'ix_email', columnIds: ['u_email'] }, { id: 'ix_wish', columnIds: ['u_wish'] }],
        },
      },
      { id: 'products', type: 'table', label: 'products', position: pos, data: { columns: [col('p_id', 'id', 'integer', { primaryKey: true, nullable: false })] } },
      {
        id: 'orders',
        type: 'table',
        label: 'orders',
        position: pos,
        data: { columns: [col('o_id', 'id', 'integer', { primaryKey: true, nullable: false }), col('o_user', 'user_id', 'integer')] },
      },
      {
        id: 'wish',
        type: 'table',
        label: 'wishlist_items',
        position: pos,
        data: {
          columns: [col('w_id', 'id', 'integer', { primaryKey: true, nullable: false }), col('w_user', 'user_id', 'integer', { nullable: false }), col('w_prod', 'product_id', 'integer')],
        },
      },
      { id: 'legacy', type: 'table', label: 'legacy_favs', position: pos, data: { columns: [col('l_id', 'id', 'integer', { primaryKey: true, nullable: false })] } },
    ],
    edges: [
      { id: 'fk_wu', kind: 'fk', source: 'wish', target: 'users', data: { sourceColumnId: 'w_user', targetColumnId: 'u_id', onDelete: 'cascade' } },
      { id: 'fk_wp', kind: 'fk', source: 'wish', target: 'products', data: { sourceColumnId: 'w_prod', targetColumnId: 'p_id' } },
      { id: 'fk_ou', kind: 'fk', source: 'orders', target: 'users', data: { sourceColumnId: 'o_user', targetColumnId: 'u_id' } },
    ],
    features: [
      {
        id: 'f',
        name: 'Wishlist',
        items: [
          { ref: { kind: 'node', id: 'users' }, role: 'changed' },
          { ref: { kind: 'node', id: 'wish' }, role: 'added' },
          { ref: { kind: 'edge', id: 'fk_wu' }, role: 'added' },
          { ref: { kind: 'edge', id: 'fk_wp' }, role: 'added' },
          { ref: { kind: 'edge', id: 'fk_ou' }, role: 'added' },
          { ref: { kind: 'node', id: 'legacy' }, role: 'removed' },
          { ref: { kind: 'node', id: 'products' }, role: 'uses' },
        ],
        baseline: { nodes: { users: usersBase } },
      },
    ],
  });
}

/** Table name -> column names, plus foreign keys and indexes, as SQLite sees them */
function inspect(db: DatabaseSync) {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  const shape = Object.fromEntries(
    tables.map((t) => [t, (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name)]),
  );
  const fks = Object.fromEntries(
    tables.map((t) => [t, (db.prepare(`PRAGMA foreign_key_list("${t}")`).all() as { table: string; from: string }[]).map((f) => `${f.from}->${f.table}`)]),
  );
  const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  return { shape, fks, indexes };
}

describe('featureMigration', () => {
  it('migrates SQLite up and down, rebuilding what it cannot alter and keeping data', () => {
    const doc = shopDoc('sqlite');
    const before = beforeFeature(doc, 'f')!;
    const db = new DatabaseSync(':memory:');
    db.exec(toSqlSchema(before));
    db.exec("INSERT INTO users (id, email, nickname) VALUES (1, 'a@b.c', 'al')");
    const start = inspect(db);
    expect(start.shape).toEqual({ legacy_favs: ['id'], orders: ['id', 'user_id'], products: ['id'], users: ['id', 'email', 'nickname'] });

    const { up, down } = featureMigration(doc, 'f')!;
    db.exec(up);
    expect(inspect(db).shape).toEqual({
      orders: ['id', 'user_id'],
      products: ['id'],
      users: ['id', 'email', 'wish_count'],
      wishlist_items: ['id', 'user_id', 'product_id'],
    });
    expect(inspect(db).fks).toMatchObject({ orders: ['user_id->users'], wishlist_items: ['product_id->products', 'user_id->users'] });
    expect(inspect(db).indexes).toEqual(['users_email_idx', 'users_wish_count_idx']);
    expect(db.prepare('SELECT id, email, wish_count FROM users').all()).toEqual([{ id: 1, email: 'a@b.c', wish_count: 0 }]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    db.exec(down);
    expect(inspect(db)).toEqual(start);
    expect(db.prepare('SELECT id, email FROM users').all()).toEqual([{ id: 1, email: 'a@b.c' }]);
  });

  it('writes PostgreSQL ALTER statements in order, with backfill notes', () => {
    const doc = CanvasDoc.parse({
      ...shopDoc('postgresql'),
      nodes: shopDoc('postgresql').nodes.map((n) =>
        n.id === 'users' && n.type === 'table'
          ? { ...n, data: { ...n.data, columns: [...n.data.columns, { id: 'u_bio', name: 'bio', type: 'text', primaryKey: false, nullable: false, unique: false }] } }
          : n,
      ),
    });
    const { up, down } = featureMigration(doc, 'f')!;
    expect(up).toContain('-- Wishlist: migration up. Generated by RuneArch for PostgreSQL');
    // Changed tables (columns in table order, then indexes), new tables, foreign keys, removed tables
    const order = [
      'ALTER TABLE users ALTER COLUMN email TYPE varchar(320) USING email::varchar(320);',
      'ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);',
      'ALTER TABLE users ADD COLUMN wish_count integer NOT NULL DEFAULT 0;',
      '-- Backfill: existing rows of users need a value for bio (NOT NULL without a default)\n\nALTER TABLE users ADD COLUMN bio text NOT NULL;',
      'ALTER TABLE users DROP COLUMN nickname;',
      'CREATE INDEX users_wish_count_idx ON users (wish_count);',
      'CREATE TABLE wishlist_items (',
      'ALTER TABLE wishlist_items ADD CONSTRAINT wishlist_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;',
      'ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id);',
      'DROP TABLE legacy_favs;',
    ];
    const at = order.map((s) => up.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);

    expect(down).toContain('CREATE TABLE legacy_favs (');
    expect(down).toContain('ALTER TABLE orders DROP CONSTRAINT orders_user_id_fkey;');
    expect(down).toContain('DROP TABLE wishlist_items;');
    expect(down).toContain('ALTER TABLE users ADD COLUMN nickname text;');
    expect(down).toContain('ALTER TABLE users ALTER COLUMN email TYPE text USING email::text;');
    expect(down).toContain('ALTER TABLE users DROP CONSTRAINT users_email_key;');
    expect(down).toContain('DROP INDEX users_wish_count_idx;');
    expect(down.indexOf('DROP TABLE wishlist_items;')).toBeLessThan(down.indexOf('ALTER TABLE users DROP COLUMN wish_count;'));
  });

  it('uses MySQL syntax: MODIFY COLUMN, DROP FOREIGN KEY, DROP INDEX … ON', () => {
    const doc = shopDoc('mysql');
    const { up, down } = featureMigration(doc, 'f')!;
    expect(up).toContain('ALTER TABLE users MODIFY COLUMN email varchar(320);');
    expect(up).toContain('ALTER TABLE users ADD UNIQUE INDEX email (email);');
    expect(down).toContain('ALTER TABLE orders DROP FOREIGN KEY orders_user_id_fkey;');
    expect(down).toContain('DROP INDEX users_wish_count_idx ON users;');
    expect(down).toContain('ALTER TABLE users DROP INDEX email;');
  });

  it('renames tables and columns, and says when there is nothing to migrate', () => {
    const doc = CanvasDoc.parse({
      ...shopDoc('postgresql'),
      nodes: shopDoc('postgresql').nodes.map((n) =>
        n.id === 'users' ? { ...usersBase, label: 'members', data: { ...usersBase.data, columns: usersBase.data.columns.map((c) => (c.id === 'u_nick' ? { ...c, name: 'handle' } : c)) } } : n,
      ),
      features: [{ id: 'f', name: 'Rename', items: [{ ref: { kind: 'node', id: 'users' }, role: 'changed' }], baseline: { nodes: { users: usersBase } } }],
    });
    const { up, down } = featureMigration(doc, 'f')!;
    expect(up).toContain('ALTER TABLE users RENAME TO members;');
    expect(up).toContain('ALTER TABLE members RENAME COLUMN nickname TO handle;');
    expect(down).toContain('ALTER TABLE members RENAME TO users;');

    const empty = CanvasDoc.parse({ ...emptyCanvas(), features: [{ id: 'f', name: 'Docs only' }] });
    expect(featureMigration(empty, 'f')!.up).toContain('-- No database changes');
    expect(featureMigration(empty, 'nope')).toBeNull();
  });
});
