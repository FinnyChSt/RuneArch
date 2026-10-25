import { CanvasDoc, emptyCanvas, toDbml, toMermaidEr, toSqlSchema } from '@flowcanvas/shared';
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

const doc = {
  ...emptyCanvas(),
  nodes: [
    {
      id: 'users',
      type: 'table',
      label: 'users',
      position: { x: 0, y: 0 },
      data: { columns: [{ id: 'u1', name: 'id', type: 'uuid', primaryKey: true }] },
    },
    {
      id: 'orders',
      type: 'table',
      label: 'orders',
      position: { x: 0, y: 0 },
      data: { columns: [{ id: 'o1', name: 'user_id', type: 'uuid' }] },
    },
  ],
  edges: [{ id: 'fk', kind: 'fk', source: 'orders', target: 'users', data: { sourceColumnId: 'o1', targetColumnId: 'u1' } }],
};

async function projectWithTables() {
  const { body } = await t.http().post('/api/projects').send({ name: 'Shop' }).expect(201);
  await t.http().put(`/api/projects/${body.id}/canvas`).send({ doc, version: 1 }).expect(200);
  return body.id as string;
}

describe('Schema export', () => {
  it.each([
    ['dbml', /text\/plain/, toDbml],
    ['mmd', /text\/vnd\.mermaid/, toMermaidEr],
    ['sql', /application\/sql/, toSqlSchema],
  ])('serves schema.%s', async (extension, contentType, render) => {
    const id = await projectWithTables();
    const res = await t.http().get(`/api/projects/${id}/schema.${extension}`).expect(200).expect('content-type', contentType);
    expect(res.text).toBe(render(CanvasDoc.parse(doc)));
  });

  it('renders SQL in the requested dialect, defaulting to the project one', async () => {
    const id = await projectWithTables();
    const res = await t.http().get(`/api/projects/${id}/schema.sql?dialect=mysql`).expect(200);
    expect(res.text).toBe(toSqlSchema(CanvasDoc.parse(doc), { dialect: 'mysql' }));
    await t.http().get(`/api/projects/${id}/schema.sql?dialect=oracle`).expect(400);
  });

  it('serves SQL that runs on PostgreSQL', async () => {
    const id = await projectWithTables();
    const { text } = await t.http().get(`/api/projects/${id}/schema.sql`).expect(200);
    const client = postgres(inject('testDatabaseUrl'), { max: 1, onnotice: () => {} });
    const rollback = new Error('rollback');
    try {
      await client.begin(async (tx) => {
        // A scratch schema, so the canvas tables don't clash with the app's own
        await tx.unsafe('create schema ddl_check; set local search_path to ddl_check');
        await tx.unsafe(text);
        const rows = await tx.unsafe(
          "select count(*)::int as n from information_schema.table_constraints where constraint_type = 'FOREIGN KEY' and table_schema = 'ddl_check'",
        );
        expect([...rows]).toEqual([{ n: 1 }]);
        throw rollback; // leave the test database untouched
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await client.end();
    }
  });

  it('rejects unknown formats', async () => {
    const id = await projectWithTables();
    await t.http().get(`/api/projects/${id}/schema.json`).expect(404);
  });

  it('is only visible to project members', async () => {
    const id = await projectWithTables();
    t.signInAs(other);
    await t.http().get(`/api/projects/${id}/schema.dbml`).expect(404);
  });
});
