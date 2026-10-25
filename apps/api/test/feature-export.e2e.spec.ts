import {
  beforeFeature,
  CanvasDoc,
  emptyCanvas,
  featureAnnotations,
  FEATURE_EXPORTS,
  scopeToFeature,
  toDbml,
  toSqlSchema,
} from '@flowcanvas/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { AuthUser } from '../src/auth/auth.js';
import { createTestApp } from './test-app.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let other: AuthUser;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(async () => {
  [, other] = (await t.reset('owner@test.local', 'other@test.local')) as [AuthUser, AuthUser];
});

const pos = { x: 0, y: 0 };
const col = (id: string, name: string, type: string, extra: object = {}) => ({ id, name, type, ...extra });
const usersBase = {
  id: 'users',
  type: 'table',
  label: 'users',
  position: pos,
  data: {
    columns: [col('u_id', 'id', 'integer', { primaryKey: true, nullable: false }), col('u_email', 'email', 'text'), col('u_nick', 'nickname', 'text')],
    indexes: [{ id: 'ix', columnIds: ['u_email'] }],
  },
};

/** Wishlist (draft) changes users, adds wishlist_items with an FK and POST /wishlist, removes legacy_favs */
const doc = CanvasDoc.parse({
  ...emptyCanvas(),
  nodes: [
    {
      ...usersBase,
      data: {
        columns: [
          col('u_id', 'id', 'integer', { primaryKey: true, nullable: false }),
          col('u_email', 'email', 'varchar(320)', { unique: true }),
          col('u_wish', 'wish_count', 'integer', { nullable: false, default: '0' }),
        ],
        indexes: [{ id: 'ix', columnIds: ['u_email'] }, { id: 'ix2', columnIds: ['u_wish'] }],
      },
    },
    {
      id: 'wish',
      type: 'table',
      label: 'wishlist_items',
      position: pos,
      data: { columns: [col('w_id', 'id', 'integer', { primaryKey: true, nullable: false }), col('w_user', 'user_id', 'integer', { nullable: false })] },
    },
    { id: 'legacy', type: 'table', label: 'legacy_favs', position: pos, data: { columns: [col('l_id', 'id', 'integer', { primaryKey: true, nullable: false })] } },
    { id: 'post', type: 'endpoint', position: pos, data: { method: 'POST', path: '/wishlist' } },
  ],
  edges: [{ id: 'fk', kind: 'fk', source: 'wish', target: 'users', data: { sourceColumnId: 'w_user', targetColumnId: 'u_id' } }],
  features: [
    {
      id: 'f',
      name: 'Wishlist',
      items: [
        { ref: { kind: 'node', id: 'users' }, role: 'changed' },
        { ref: { kind: 'node', id: 'wish' }, role: 'added' },
        { ref: { kind: 'edge', id: 'fk' }, role: 'added' },
        { ref: { kind: 'node', id: 'post' }, role: 'added' },
        { ref: { kind: 'node', id: 'legacy' }, role: 'removed' },
      ],
      baseline: { nodes: { users: usersBase } },
    },
  ],
});

async function project() {
  const { body } = await t.http().post('/api/projects').send({ name: 'Shop' }).expect(201);
  await t.http().put(`/api/projects/${body.id}/canvas`).send({ doc, version: 1 }).expect(200);
  return body.id as string;
}

/** Runs `work` in a scratch schema inside a transaction that is always rolled back */
async function inScratchSchema(work: (tx: postgres.TransactionSql) => Promise<void>) {
  const client = postgres(inject('testDatabaseUrl'), { max: 1, onnotice: () => {} });
  const rollback = new Error('rollback');
  try {
    await client.begin(async (tx) => {
      await tx.unsafe('create schema feature_check; set local search_path to feature_check');
      await work(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await client.end();
  }
}

describe('Feature exports', () => {
  it('serves every feature export, the same as the shared renderers', async () => {
    const id = await project();
    for (const format of Object.values(FEATURE_EXPORTS)) {
      const res = await t.http().get(`/api/projects/${id}/features/f/${format.file}`).expect(200);
      expect(res.headers['content-type']).toContain(format.mimeType);
      expect(res.text).toBe(format.render(doc, 'f'));
    }
    const mysql = await t.http().get(`/api/projects/${id}/features/f/migration.up.sql?dialect=mysql`).expect(200);
    expect(mysql.text).toContain('MODIFY COLUMN');
  });

  it('runs the PostgreSQL migration up and down', async () => {
    const id = await project();
    const up = (await t.http().get(`/api/projects/${id}/features/f/migration.up.sql`).expect(200)).text;
    const down = (await t.http().get(`/api/projects/${id}/features/f/migration.down.sql`).expect(200)).text;
    const columns = async (tx: postgres.TransactionSql) =>
      [
        ...(await tx.unsafe(
          "select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'feature_check' order by table_name, ordinal_position",
        )),
      ].map((r) => r.c as string);

    await inScratchSchema(async (tx) => {
      await tx.unsafe(toSqlSchema(beforeFeature(doc, 'f')!));
      await tx.unsafe("insert into users (id, email, nickname) values (1, 'a@b.c', 'al')");
      const start = await columns(tx);
      expect(start).toEqual(['legacy_favs.id', 'users.id', 'users.email', 'users.nickname']);

      await tx.unsafe(up);
      expect(await columns(tx)).toEqual(['users.id', 'users.email', 'users.wish_count', 'wishlist_items.id', 'wishlist_items.user_id']);
      expect([...(await tx.unsafe('select id, email, wish_count from users'))]).toEqual([{ id: 1, email: 'a@b.c', wish_count: 0 }]);

      await tx.unsafe(down);
      expect((await columns(tx)).sort()).toEqual([...start].sort());
    });
  });

  it('rejects unknown features, files and dialects, and non-members', async () => {
    const id = await project();
    await t.http().get(`/api/projects/${id}/features/nope/brief.md`).expect(404);
    await t.http().get(`/api/projects/${id}/features/f/brief.txt`).expect(404);
    await t.http().get(`/api/projects/${id}/features/f/migration.up.sql?dialect=oracle`).expect(400);
    t.signInAs(other);
    await t.http().get(`/api/projects/${id}/features/f/brief.md`).expect(404);
  });
});

describe('?feature and ?unshipped on the project exports', () => {
  it('scopes the schema, OpenAPI and canvas exports to a feature', async () => {
    const id = await project();
    const dbml = await t.http().get(`/api/projects/${id}/schema.dbml?feature=f`).expect(200);
    expect(dbml.text).toBe(toDbml(scopeToFeature(doc, 'f')!.doc, { feature: featureAnnotations(doc, 'f')! }));
    const spec = await t.http().get(`/api/projects/${id}/openapi.json?feature=f`).expect(200);
    expect(spec.body.paths['/wishlist'].post['x-feature-status']).toBe('new');
    const yaml = await t.http().get(`/api/projects/${id}/openapi.yaml?feature=f&only=changes`).expect(200);
    expect(yaml.text).toContain('x-feature-status: new');
    const mmd = await t.http().get(`/api/projects/${id}/canvas.mmd?feature=f`).expect(200);
    expect(mmd.text).toContain('Feature: Wishlist');
  });

  it('leaves out unshipped additions on request', async () => {
    const id = await project();
    const all = await t.http().get(`/api/projects/${id}/schema.sql`).expect(200);
    expect(all.text).toContain('CREATE TABLE wishlist_items');
    const shipped = await t.http().get(`/api/projects/${id}/schema.sql?unshipped=exclude`).expect(200);
    expect(shipped.text).not.toContain('wishlist_items');
    const spec = await t.http().get(`/api/projects/${id}/openapi.json?unshipped=exclude`).expect(200);
    expect(spec.body.paths).toEqual({});
  });

  it('rejects bad values', async () => {
    const id = await project();
    await t.http().get(`/api/projects/${id}/schema.dbml?feature=nope`).expect(404);
    await t.http().get(`/api/projects/${id}/canvas.svg?unshipped=maybe`).expect(400);
    await t.http().get(`/api/projects/${id}/openapi.json?only=everything`).expect(400);
  });
});
