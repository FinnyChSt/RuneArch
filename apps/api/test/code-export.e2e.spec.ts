import { CanvasDoc, emptyCanvas, scopeToFeature, toDrizzle, toFastApi, toPrisma, toPydantic, toSqlAlchemy, toSqlModel, toZod } from '@flowcanvas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
      data: { columns: [{ id: 'o1', name: 'user_id', type: 'uuid', primaryKey: true }] },
    },
    { id: 'get', type: 'endpoint', position: { x: 0, y: 0 }, data: { method: 'GET', path: '/users' } },
  ],
  edges: [{ id: 'fk', kind: 'fk', source: 'orders', target: 'users', data: { sourceColumnId: 'o1', targetColumnId: 'u1' } }],
  models: [{ id: 'm', name: 'UserDto', fields: [{ id: 'f', name: 'userId', type: { kind: 'primitive', type: 'string', format: 'uuid' } }] }],
  features: [{ id: 'feat', name: 'Orders', status: 'draft', items: [{ ref: { kind: 'node', id: 'orders' }, role: 'added' }] }],
};

async function project() {
  const { body } = await t.http().post('/api/projects').send({ name: 'Shop' }).expect(201);
  await t.http().put(`/api/projects/${body.id}/canvas`).send({ doc, version: 1 }).expect(200);
  return body.id as string;
}

describe('Code export', () => {
  it.each([
    ['pydantic', toPydantic, /text\/x-python/],
    ['sqlalchemy', toSqlAlchemy, /text\/x-python/],
    ['sqlmodel', toSqlModel, /text\/x-python/],
    ['fastapi', toFastApi, /text\/x-python/],
    ['zod', toZod, /text\/typescript/],
    ['drizzle', toDrizzle, /text\/typescript/],
    ['prisma', toPrisma, /text\/plain/],
  ])('serves code/%s', async (target, render, contentType) => {
    const id = await project();
    const res = await t.http().get(`/api/projects/${id}/code/${target}`).expect(200).expect('content-type', contentType);
    expect(res.text).toBe(render(CanvasDoc.parse(doc)));
  });

  it('scopes to a feature', async () => {
    const id = await project();
    const res = await t.http().get(`/api/projects/${id}/code/sqlalchemy?feature=feat`).expect(200);
    const scoped = scopeToFeature(CanvasDoc.parse(doc), 'feat')!;
    expect(res.text).toBe(toSqlAlchemy(scoped.doc, scoped));
    expect(res.text).toContain('# new in Orders');
    await t.http().get(`/api/projects/${id}/code/sqlalchemy?feature=nope`).expect(404);
  });

  it('rejects unknown targets', async () => {
    const id = await project();
    await t.http().get(`/api/projects/${id}/code/cobol`).expect(404);
  });

  it('is only visible to project members', async () => {
    const id = await project();
    t.signInAs(other);
    await t.http().get(`/api/projects/${id}/code/pydantic`).expect(404);
  });
});
