import { CanvasDoc, canvasToSvg, emptyCanvas, toCanvasJson, toMermaidFlowchart } from '@flowcanvas/shared';
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
    { id: 'cart', type: 'screen', label: 'Cart', position: { x: 0, y: 0 }, data: { route: '/cart' } },
    { id: 'post', type: 'endpoint', position: { x: 300, y: 0 }, data: { method: 'POST', path: '/orders' } },
  ],
  edges: [{ id: 'e', kind: 'calls', source: 'cart', target: 'post' }],
  flows: [{ id: 'f', name: 'Checkout', color: 'teal', steps: [{ edgeId: 'e' }] }],
};
const parsed = CanvasDoc.parse(doc);

async function project() {
  const { body } = await t.http().post('/api/projects').send({ name: 'Shop' }).expect(201);
  await t.http().put(`/api/projects/${body.id}/canvas`).send({ doc, version: 1 }).expect(200);
  return body.id as string;
}

/** supertest leaves SVG bodies unparsed; read them as text */
const asText = (req: ReturnType<ReturnType<typeof t.http>['get']>) =>
  req.buffer(true).parse((r, done) => {
    let text = '';
    r.on('data', (chunk: Buffer) => (text += chunk.toString()));
    r.on('end', () => done(null, text));
  });

describe('Canvas export', () => {
  it('serves the canvas as SVG, with theme and flow options', async () => {
    const id = await project();
    const plain = await asText(t.http().get(`/api/projects/${id}/canvas.svg`)).expect(200).expect('content-type', /image\/svg\+xml/);
    expect(plain.body).toBe(canvasToSvg(parsed));
    const flow = await asText(t.http().get(`/api/projects/${id}/canvas.svg?theme=dark&flow=f`)).expect(200);
    expect(flow.body).toBe(canvasToSvg(parsed, { theme: 'dark', flowId: 'f' }));
  });

  it('serves Mermaid and JSON', async () => {
    const id = await project();
    const mmd = await t.http().get(`/api/projects/${id}/canvas.mmd?flow=f`).expect(200).expect('content-type', /text\/vnd\.mermaid/);
    expect(mmd.text).toBe(toMermaidFlowchart(parsed, { flowId: 'f' }));
    const json = await t.http().get(`/api/projects/${id}/canvas.json`).expect(200).expect('content-type', /application\/json/);
    // jsonb keeps keys in its own order, so compare values
    expect(JSON.parse(json.text)).toEqual(JSON.parse(toCanvasJson(parsed)));
  });

  it('rejects unknown formats, themes and flows', async () => {
    const id = await project();
    await t.http().get(`/api/projects/${id}/canvas.png`).expect(404);
    await t.http().get(`/api/projects/${id}/canvas.svg?theme=neon`).expect(400);
    await t.http().get(`/api/projects/${id}/canvas.svg?flow=nope`).expect(404);
  });

  it('is only visible to project members', async () => {
    const id = await project();
    t.signInAs(other);
    await t.http().get(`/api/projects/${id}/canvas.svg`).expect(404);
  });
});
