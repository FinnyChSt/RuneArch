import { CanvasDoc, emptyCanvas, estimateNodeSize, parseOpenApi, specToYaml, toOpenApi, type CanvasNode, type ImportedApi } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { shopDoc } from '../test/fixtures';
import { buildApiImport, defaultApplySettings, importApi } from './apiImportOps';

const parsed = (text: string): ImportedApi => {
  const result = parseOpenApi(text);
  if (!result.ok) throw new Error(result.error);
  return result.api;
};

const str = { kind: 'primitive', type: 'string' } as const;

/** A small API designed on the canvas: two tags, an untagged endpoint, nested models */
function designedApi(): CanvasDoc {
  return CanvasDoc.parse({
    ...emptyCanvas(),
    api: { title: 'Shop', version: '2.1.0', servers: [{ url: 'https://shop.test' }], auth: 'apiKey', apiKeyHeader: 'X-Key' },
    models: [
      { id: 'm-line', name: 'LineDto', fields: [{ id: 'l1', name: 'sku', type: str }] },
      {
        id: 'm-order',
        name: 'OrderDto',
        description: 'An order',
        fields: [
          { id: 'o1', name: 'id', type: { ...str, format: 'uuid' } },
          { id: 'o2', name: 'lines', type: { kind: 'array', items: { kind: 'ref', modelId: 'm-line' } } },
        ],
      },
    ],
    nodes: [
      { id: 'a', type: 'endpoint', position: { x: 0, y: 0 }, data: { method: 'GET', path: '/orders', spec: { tags: ['orders'], responses: [{ status: '200', body: { kind: 'array', items: { kind: 'ref', modelId: 'm-order' } } }] } } },
      { id: 'b', type: 'endpoint', position: { x: 0, y: 0 }, data: { method: 'POST', path: '/orders', auth: 'admin', spec: { tags: ['orders'], requestBody: { type: { kind: 'ref', modelId: 'm-order' } }, responses: [{ status: '201' }] } } },
      { id: 'c', type: 'endpoint', position: { x: 0, y: 0 }, data: { method: 'GET', path: '/lines/{sku}', spec: { tags: ['lines'], params: [{ id: 'p', name: 'sku', in: 'path', type: str, required: true }] } } },
      { id: 'd', type: 'endpoint', position: { x: 0, y: 0 }, data: { method: 'GET', path: '/health', auth: 'public' } },
    ],
  });
}

const endpoints = (doc: CanvasDoc) => doc.nodes.filter((n) => n.type === 'endpoint');
const byRoute = (doc: CanvasDoc, route: string) =>
  doc.nodes.find((n): n is Extract<CanvasNode, { type: 'endpoint' }> => n.type === 'endpoint' && `${n.data.method} ${n.data.path}` === route)!;

describe('importing into an empty canvas', () => {
  const spec = toOpenApi(designedApi());
  const result = importApi(emptyCanvas(), parsed(specToYaml(spec)), { applySettings: true });

  it('gives back the same API', () => {
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(toOpenApi(result.doc)).toEqual(spec);
    expect(result.endpoints.added).toHaveLength(4);
    expect(result.models.added).toHaveLength(2);
    expect(result.settingsChanged).toBe(true);
  });

  it('groups new endpoints in one frame per first tag, untagged ones last without a frame', () => {
    const frames = result.doc.nodes.filter((n) => n.type === 'frame');
    expect(frames.map((f) => f.label)).toEqual(expect.arrayContaining(['orders', 'lines']));
    expect(frames).toHaveLength(2);
    const ordersFrame = frames.find((f) => f.label === 'orders')!;
    expect([byRoute(result.doc, 'GET /orders'), byRoute(result.doc, 'POST /orders')].every((n) => n.parentId === ordersFrame.id)).toBe(true);
    const health = byRoute(result.doc, 'GET /health');
    expect(health.parentId).toBeUndefined();
    const right = (f: CanvasNode) => f.position.x + f.size!.width;
    expect(health.position.x).toBeGreaterThan(Math.max(...frames.map(right)));
  });
});

describe('importing into a canvas that has some of the API', () => {
  const spec = `
openapi: 3.0.3
info: { title: Shop, version: "3.0" }
paths:
  /orders:
    get:
      responses: { "200": { description: "" } }
    post:
      summary: Create an order
      requestBody: { required: true, content: { application/json: { schema: { $ref: "#/components/schemas/OrderDto" } } } }
      responses: { "201": { description: Created } }
  /orders/{id}:
    get:
      tags: [orders]
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: "", content: { application/json: { schema: { $ref: "#/components/schemas/OrderDto" } } } } }
components:
  schemas:
    OrderDto:
      type: object
      required: [id]
      properties: { id: { type: string, format: uuid }, total: { type: number } }
`;
  const before = (): CanvasDoc =>
    CanvasDoc.parse({
      ...shopDoc(),
      models: [{ id: 'model-order', name: 'orderdto', fields: [{ id: 'field-id', name: 'id', type: str }] }],
      nodes: [
        ...shopDoc().nodes,
        { id: 'del', type: 'endpoint', position: { x: 0, y: 600 }, data: { method: 'DELETE', path: '/orders/{orderId}', spec: { params: [{ id: 'x', name: 'orderId', in: 'path', type: str, required: true }] } } },
      ],
    });
  const doc = before();
  const result = importApi(doc, parsed(spec), { applySettings: defaultApplySettings(doc) });

  it('updates matches in place, keeping ids, positions, edges and flows', () => {
    expect(result.issues).toEqual([]);
    expect(result.endpoints).toEqual({ added: [expect.any(String)], updated: ['post'], unchanged: ['get'] });
    const post = byRoute(result.doc, 'POST /orders');
    expect(post.id).toBe('post');
    expect(post.position).toEqual(byRoute(doc, 'POST /orders').position);
    expect(post.data.spec.summary).toBe('Create an order');
    expect(post.data.spec.requestBody?.type).toEqual({ kind: 'ref', modelId: 'model-order' });
    expect(result.doc.edges.find((e) => e.id === 'w')).toEqual(doc.edges.find((e) => e.id === 'w'));
    expect(result.doc.flows).toEqual(doc.flows);
  });

  it('updates models by name, keeping model and field ids', () => {
    expect(result.models).toEqual({ added: [], updated: ['model-order'], unchanged: [] });
    const model = result.doc.models[0]!;
    expect(model).toMatchObject({ id: 'model-order', name: 'OrderDto' });
    expect(model.fields.map((f) => [f.id, f.name])).toEqual([
      ['field-id', 'id'],
      [expect.any(String), 'total'],
    ]);
  });

  it('matches routes across renamed path params, never deletes and reports what the spec lacks', () => {
    // GET /orders/{id} is new, DELETE /orders/{orderId} is not in the spec and stays
    expect(byRoute(result.doc, 'DELETE /orders/{orderId}').id).toBe('del');
    expect(result.missing).toEqual({ models: [], endpoints: ['del'] });
    expect(endpoints(result.doc)).toHaveLength(4);
  });

  it('places new endpoints right of the existing content and keeps the API settings', () => {
    const added = result.doc.nodes.find((n) => n.id === result.endpoints.added[0])!;
    const frame = result.doc.nodes.find((n) => n.id === added.parentId)!;
    expect(frame.label).toBe('orders');
    const existingRight = Math.max(...doc.nodes.map((n) => n.position.x + estimateNodeSize(n).width));
    expect(frame.position.x).toBeGreaterThan(existingRight);
    expect(result.settingsChanged).toBe(false);
    expect(result.doc.api).toEqual(doc.api);
  });

  it('is a no-op when the same spec is imported again', () => {
    const again = importApi(result.doc, parsed(spec), { applySettings: false });
    expect(again.doc).toBe(result.doc);
    expect(again.endpoints.added.length + again.endpoints.updated.length).toBe(0);
    expect(again.models).toEqual({ added: [], updated: [], unchanged: ['model-order'] });
  });

  it('matches a route whose path params were renamed', () => {
    const renamed = parsed(spec.replace('/orders/{id}:', '/orders/{orderId}:').replace('name: id,', 'name: orderId,'));
    const withGet = CanvasDoc.parse({
      ...doc,
      nodes: [...doc.nodes, { id: 'one', type: 'endpoint', position: { x: 0, y: 0 }, data: { method: 'GET', path: '/orders/{key}', spec: { params: [{ id: 'k', name: 'key', in: 'path', type: str, required: true }] } } }],
    });
    const r = buildApiImport(withGet, renamed, { applySettings: false });
    expect(r.endpoints.updated).toContain('one');
    expect(byRoute(r.doc, 'GET /orders/{orderId}').id).toBe('one');
  });
});

describe('import rules', () => {
  it('drops an operationId another endpoint on the canvas already uses', () => {
    const doc = CanvasDoc.parse({
      ...emptyCanvas(),
      nodes: [{ id: 'legacy', type: 'endpoint', position: { x: 0, y: 0 }, data: { method: 'GET', path: '/legacy', spec: { operationId: 'createOrder' } } }],
    });
    const api = parsed('{"openapi":"3.1.0","info":{"title":"x","version":"1"},"paths":{"/orders":{"post":{"operationId":"createOrder","responses":{"201":{"description":""}}}}}}');
    const result = buildApiImport(doc, api, { applySettings: false });
    expect(result.issues).toEqual([]);
    expect(byRoute(result.doc, 'POST /orders').data.spec.operationId).toBeUndefined();
    expect(result.warnings.map((w) => w.text)).toEqual(['POST /orders: operationId createOrder is used by another endpoint on the canvas; dropped']);
  });

  it('takes the spec settings by default only on a canvas without endpoints', () => {
    expect(defaultApplySettings(emptyCanvas())).toBe(true);
    expect(defaultApplySettings(shopDoc())).toBe(false);
  });

  it('wraps big tags into several columns inside one frame', () => {
    const paths = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [`/items/${String(i).padStart(2, '0')}`, { get: { tags: ['items'], responses: { '200': { description: '' } } } }]),
    );
    const api = parsed(JSON.stringify({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths }));
    const result = importApi(emptyCanvas(), api, { applySettings: true });
    const xs = new Set(endpoints(result.doc).map((n) => n.position.x));
    expect(xs.size).toBe(2);
    expect(result.doc.nodes.filter((n) => n.type === 'frame')).toHaveLength(1);
  });
});
