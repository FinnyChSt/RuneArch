import { CanvasDoc, emptyCanvas, toScreensJson, toScreensMarkdown, wireComponentsOf, Wireframe, wireframeToSvg } from '@flowcanvas/shared';
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

const wireframe = {
  device: 'desktop',
  elements: [
    { id: 'go', kind: 'button', rect: { x: 0, y: 0, w: 3, h: 5 }, text: 'Place order', variant: 'primary' },
    { id: 'box', kind: 'instance', rect: { x: 0, y: 6, w: 12, h: 6 }, componentId: 'card' },
  ],
};

const doc = {
  ...emptyCanvas(),
  nodes: [
    { id: 'cart', type: 'screen', label: 'Cart', position: { x: 0, y: 0 }, data: { route: '/cart', wireframe } },
    { id: 'home', type: 'screen', label: 'Home', position: { x: 0, y: 200 }, data: {} },
    {
      id: 'card',
      type: 'component',
      label: 'Card',
      position: { x: 0, y: 400 },
      data: { wireframe: { elements: [{ id: 't', kind: 'text', rect: { x: 0, y: 0, w: 12, h: 4 }, text: 'Inside the card' }] } },
    },
    { id: 'post', type: 'endpoint', position: { x: 300, y: 0 }, data: { method: 'POST', path: '/orders' } },
  ],
  edges: [{ id: 'click', kind: 'calls', source: 'cart', target: 'post', sourceHandle: 'el:go' }],
};

async function projectWithScreens() {
  const { body } = await t.http().post('/api/projects').send({ name: 'Shop' }).expect(201);
  await t.http().put(`/api/projects/${body.id}/canvas`).send({ doc, version: 1 }).expect(200);
  return body.id as string;
}

describe('Screen export', () => {
  it.each([
    ['md', /text\/markdown/, toScreensMarkdown],
    ['json', /application\/json/, toScreensJson],
  ])('serves screens.%s', async (extension, contentType, render) => {
    const id = await projectWithScreens();
    const res = await t.http().get(`/api/projects/${id}/screens.${extension}`).expect(200).expect('content-type', contentType);
    expect(res.text).toBe(render(CanvasDoc.parse(doc)));
  });

  it('serves a screen wireframe as SVG', async () => {
    const id = await projectWithScreens();
    const res = await t
      .http()
      .get(`/api/projects/${id}/screens/cart/wireframe.svg`)
      .buffer(true)
      .parse((r, done) => {
        let text = '';
        r.on('data', (chunk: Buffer) => (text += chunk.toString()));
        r.on('end', () => done(null, text));
      })
      .expect(200)
      .expect('content-type', /image\/svg\+xml/);
    expect(res.body).toBe(wireframeToSvg(Wireframe.parse(wireframe), { title: 'Cart', components: wireComponentsOf(CanvasDoc.parse(doc)) }));
    expect(res.body).toContain('Inside the card');
  });

  it('404s for unknown formats and screens without a wireframe', async () => {
    const id = await projectWithScreens();
    await t.http().get(`/api/projects/${id}/screens.txt`).expect(404);
    await t.http().get(`/api/projects/${id}/screens/home/wireframe.svg`).expect(404);
    await t.http().get(`/api/projects/${id}/screens/post/wireframe.svg`).expect(404);
  });

  it('is only visible to project members', async () => {
    const id = await projectWithScreens();
    t.signInAs(other);
    await t.http().get(`/api/projects/${id}/screens.md`).expect(404);
    await t.http().get(`/api/projects/${id}/screens/cart/wireframe.svg`).expect(404);
  });
});
