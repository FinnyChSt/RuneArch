import { emptyCanvas } from '@flowcanvas/shared';
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

const withScreen = (label: string) => ({
  ...emptyCanvas(),
  nodes: [{ id: 's', type: 'screen', label, position: { x: 0, y: 0 }, data: {} }],
});
const labelOf = (doc: { nodes: { label: string }[] }) => doc.nodes[0]?.label;

/** A project saved as version 2 with a screen called `label` */
async function project(label = 'First') {
  const { body } = await t.http().post('/api/projects').send({ name: 'Shop' }).expect(201);
  await t.http().put(`/api/projects/${body.id}/canvas`).send({ doc: withScreen(label), version: 1 }).expect(200);
  return body.id as string;
}

describe('Snapshots', () => {
  it('checkpoints the saved canvas and lists checkpoints newest first, without docs', async () => {
    const id = await project();
    const first = await t.http().post(`/api/projects/${id}/snapshots`).send({ label: '  Before refactor ' }).expect(201);
    expect(first.body).toEqual({ id: expect.any(String), label: 'Before refactor', createdAt: expect.any(String), createdBy: 'owner' });
    await t.http().post(`/api/projects/${id}/snapshots`).send({}).expect(201);

    const list = await t.http().get(`/api/projects/${id}/snapshots`).expect(200);
    expect(list.body.map((s: { label: string | null }) => s.label)).toEqual([null, 'Before refactor']);
    expect(list.body[0]).not.toHaveProperty('doc');

    const detail = await t.http().get(`/api/projects/${id}/snapshots/${first.body.id}`).expect(200);
    expect(labelOf(detail.body.doc)).toBe('First');
  });

  it('restores a checkpoint as a new version, checkpointing the current canvas first', async () => {
    const id = await project('First');
    const snap = await t.http().post(`/api/projects/${id}/snapshots`).send({ label: 'v1' }).expect(201);
    await t.http().put(`/api/projects/${id}/canvas`).send({ doc: withScreen('Second'), version: 2 }).expect(200);

    const restored = await t.http().post(`/api/projects/${id}/snapshots/${snap.body.id}/restore`).expect(200);
    expect(restored.body.version).toBe(4);
    expect(labelOf(restored.body.doc)).toBe('First');
    const canvas = await t.http().get(`/api/projects/${id}/canvas`).expect(200);
    expect(canvas.body.version).toBe(4);
    expect(labelOf(canvas.body.doc)).toBe('First');

    // The doc it replaced was kept, so the restore can be undone
    const list = await t.http().get(`/api/projects/${id}/snapshots`).expect(200);
    expect(list.body[0].label).toBe('Before restoring “v1”');
    const before = await t.http().get(`/api/projects/${id}/snapshots/${list.body[0].id}`).expect(200);
    expect(labelOf(before.body.doc)).toBe('Second');
    // A tab still on version 3 now gets a conflict
    await t.http().put(`/api/projects/${id}/canvas`).send({ doc: withScreen('Stale'), version: 3 }).expect(409);
  });

  it('deletes checkpoints; unknown ones are 404, malformed ids 400', async () => {
    const id = await project();
    const snap = await t.http().post(`/api/projects/${id}/snapshots`).send({ label: 'x' }).expect(201);
    await t.http().delete(`/api/projects/${id}/snapshots/${snap.body.id}`).expect(204);
    await t.http().delete(`/api/projects/${id}/snapshots/${snap.body.id}`).expect(404);
    await t.http().get(`/api/projects/${id}/snapshots/${snap.body.id}`).expect(404);
    await t.http().post(`/api/projects/${id}/snapshots/${snap.body.id}/restore`).expect(404);
    await t.http().get(`/api/projects/${id}/snapshots/not-a-uuid`).expect(400);
    await t.http().post(`/api/projects/${id}/snapshots`).send({ label: 'x'.repeat(121) }).expect(400);
  });

  it('keeps checkpoints within their project', async () => {
    const a = await project();
    const b = await project();
    const snap = await t.http().post(`/api/projects/${a}/snapshots`).send({}).expect(201);
    await t.http().get(`/api/projects/${b}/snapshots/${snap.body.id}`).expect(404);
    await t.http().post(`/api/projects/${b}/snapshots/${snap.body.id}/restore`).expect(404);
  });

  it('lets viewers list and read, editors change; non-members see nothing', async () => {
    const id = await project();
    const snap = await t.http().post(`/api/projects/${id}/snapshots`).send({}).expect(201);
    t.signInAs(other);
    await t.http().get(`/api/projects/${id}/snapshots`).expect(404);

    t.signInAs(owner);
    await t.addMember(id, other, 'viewer');
    t.signInAs(other);
    await t.http().get(`/api/projects/${id}/snapshots`).expect(200);
    await t.http().get(`/api/projects/${id}/snapshots/${snap.body.id}`).expect(200);
    await t.http().post(`/api/projects/${id}/snapshots`).send({}).expect(403);
    await t.http().post(`/api/projects/${id}/snapshots/${snap.body.id}/restore`).expect(403);
    await t.http().delete(`/api/projects/${id}/snapshots/${snap.body.id}`).expect(403);
  });
});
