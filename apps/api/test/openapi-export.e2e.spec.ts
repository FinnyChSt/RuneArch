import { emptyCanvas } from '@flowcanvas/shared';
import { parse } from 'yaml';
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

async function projectWithEndpoint() {
  const { body } = await t.http().post('/api/projects').send({ name: 'Shop' }).expect(201);
  const doc = {
    ...emptyCanvas(),
    api: { ...emptyCanvas().api, title: 'Shop API' },
    nodes: [{ id: 'e', type: 'endpoint', position: { x: 0, y: 0 }, data: { method: 'GET', path: '/orders' } }],
  };
  await t.http().put(`/api/projects/${body.id}/canvas`).send({ doc, version: 1 }).expect(200);
  return body.id as string;
}

describe('OpenAPI export', () => {
  it('serves the live spec as JSON', async () => {
    const id = await projectWithEndpoint();
    const res = await t.http().get(`/api/projects/${id}/openapi.json`).expect(200).expect('content-type', /json/);
    expect(res.body).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Shop API' },
      paths: { '/orders': { get: { operationId: 'getOrders' } } },
    });
  });

  it('serves the same spec as YAML', async () => {
    const id = await projectWithEndpoint();
    const json = (await t.http().get(`/api/projects/${id}/openapi.json`)).body;
    const res = await t.http().get(`/api/projects/${id}/openapi.yaml`).expect(200).expect('content-type', /application\/yaml/);
    expect(parse(res.text)).toEqual(json);
  });

  it('is only visible to project members', async () => {
    const id = await projectWithEndpoint();
    t.signInAs(other);
    await t.http().get(`/api/projects/${id}/openapi.json`).expect(404);
    await t.http().get(`/api/projects/${id}/openapi.yaml`).expect(404);
  });
});
