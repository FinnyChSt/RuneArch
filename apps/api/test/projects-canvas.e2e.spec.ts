import { emptyCanvas, type CanvasDoc } from '@flowcanvas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/auth/auth.js';
import { createTestApp } from './test-app.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let owner: AuthUser;
let other: AuthUser;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});
beforeEach(async () => {
  [owner, other] = (await t.reset('owner@test.local', 'other@test.local')) as [AuthUser, AuthUser];
});

const createProject = async (name = 'Shop') => {
  const res = await t.http().post('/api/projects').send({ name }).expect(201);
  return res.body.id as string;
};

const screenDoc = (label = 'Home'): CanvasDoc => ({
  ...emptyCanvas(),
  nodes: [{ id: 'n1', type: 'screen', position: { x: 0, y: 0 }, label, data: { state: [] } }],
});

describe('projects', () => {
  it('creates a project with an empty canvas at version 1', async () => {
    const res = await t.http().post('/api/projects').send({ name: '  Shop  ' }).expect(201);
    expect(res.body).toMatchObject({ name: 'Shop', role: 'owner' });

    const canvas = await t.http().get(`/api/projects/${res.body.id}/canvas`).expect(200);
    expect(canvas.body).toEqual({ doc: emptyCanvas(), version: 1 });
  });

  it("lists only the current user's projects, most recently updated first", async () => {
    const first = await createProject('First');
    await createProject('Second');
    await t.http().put(`/api/projects/${first}/canvas`).send({ doc: screenDoc(), version: 1 }).expect(200);
    t.signInAs(other);
    await createProject('Theirs');

    expect((await t.http().get('/api/projects').expect(200)).body.map((p: { name: string }) => p.name)).toEqual([
      'Theirs',
    ]);
    t.signInAs(owner);
    expect((await t.http().get('/api/projects').expect(200)).body.map((p: { name: string }) => p.name)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('renames and deletes', async () => {
    const id = await createProject();
    const renamed = await t.http().patch(`/api/projects/${id}`).send({ name: 'Store' }).expect(200);
    expect(renamed.body.name).toBe('Store');
    await t.http().delete(`/api/projects/${id}`).expect(204);
    await t.http().get(`/api/projects/${id}`).expect(404);
  });

  it('rejects invalid names with issues', async () => {
    const res = await t.http().post('/api/projects').send({ name: ' ' }).expect(400);
    expect(res.body.issues[0]).toMatchObject({ path: ['name'] });
  });
});

describe('project access', () => {
  it('hides projects from non-members and for malformed ids', async () => {
    const id = await createProject();
    t.signInAs(other);
    await t.http().get(`/api/projects/${id}`).expect(404);
    await t.http().get(`/api/projects/${id}/canvas`).expect(404);
    await t.http().get('/api/projects/not-a-uuid').expect(404);
  });

  it('viewers can read but not write', async () => {
    const id = await createProject();
    await t.addMember(id, other, 'viewer');
    t.signInAs(other);
    expect((await t.http().get(`/api/projects/${id}`).expect(200)).body.role).toBe('viewer');
    await t.http().get(`/api/projects/${id}/canvas`).expect(200);
    await t.http().put(`/api/projects/${id}/canvas`).send({ doc: screenDoc(), version: 1 }).expect(403);
    await t.http().patch(`/api/projects/${id}`).send({ name: 'x' }).expect(403);
  });

  it('editors can write but only owners delete', async () => {
    const id = await createProject();
    await t.addMember(id, other, 'editor');
    t.signInAs(other);
    await t.http().put(`/api/projects/${id}/canvas`).send({ doc: screenDoc(), version: 1 }).expect(200);
    await t.http().delete(`/api/projects/${id}`).expect(403);
  });
});

describe('canvas save', () => {
  it('saves the doc and increments the version', async () => {
    const id = await createProject();
    const res = await t.http().put(`/api/projects/${id}/canvas`).send({ doc: screenDoc(), version: 1 }).expect(200);
    expect(res.body).toEqual({ version: 2 });
    const loaded = await t.http().get(`/api/projects/${id}/canvas`).expect(200);
    expect(loaded.body).toEqual({ doc: screenDoc(), version: 2 });
  });

  it('returns 409 with the current version when the base version is stale', async () => {
    const id = await createProject();
    await t.http().put(`/api/projects/${id}/canvas`).send({ doc: screenDoc('A'), version: 1 }).expect(200);
    const res = await t.http().put(`/api/projects/${id}/canvas`).send({ doc: screenDoc('B'), version: 1 }).expect(409);
    expect(res.body).toEqual({ currentVersion: 2 });
    const loaded = await t.http().get(`/api/projects/${id}/canvas`).expect(200);
    expect(loaded.body.doc.nodes[0].label).toBe('A');
  });

  it('rejects docs that break integrity rules, with paths', async () => {
    const id = await createProject();
    const doc = { ...emptyCanvas(), edges: [{ id: 'e', kind: 'calls', source: 'a', target: 'b' }] };
    const res = await t.http().put(`/api/projects/${id}/canvas`).send({ doc, version: 1 }).expect(400);
    expect(res.body).toEqual({ issues: [{ path: ['doc', 'edges', 0], message: 'Edge references a missing node' }] });
  });

  it('stores the parsed doc with defaults filled in', async () => {
    const id = await createProject();
    const minimal = { schemaVersion: 1, nodes: [], edges: [], flows: [] };
    await t.http().put(`/api/projects/${id}/canvas`).send({ doc: minimal, version: 1 }).expect(200);
    expect((await t.http().get(`/api/projects/${id}/canvas`)).body.doc).toEqual(emptyCanvas());
  });

  it('accepts documents larger than the default body limit', async () => {
    const id = await createProject();
    const nodes = Array.from({ length: 2000 }, (_, i) => ({
      id: `n${i}`,
      type: 'screen' as const,
      position: { x: i, y: i },
      label: `Screen number ${i}`,
      data: { state: [] },
    }));
    await t.http().put(`/api/projects/${id}/canvas`).send({ doc: { ...emptyCanvas(), nodes }, version: 1 }).expect(200);
  });

  it('rejects malformed JSON with 400', async () => {
    const id = await createProject();
    await t.http().put(`/api/projects/${id}/canvas`).set('content-type', 'application/json').send('{"doc":').expect(400);
  });
});
