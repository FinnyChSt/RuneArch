import { describe, expect, it } from 'vitest';
import { CanvasDoc, canAppendStep, componentUsages, wireComponentsOf, elementHandleId, elementIdOf, emptyCanvas, Wireframe, wireframeRows } from '../src';

type DocInput = Record<string, unknown>;

const screen = (id: string, extra: DocInput = {}) => ({
  id,
  type: 'screen',
  position: { x: 0, y: 0 },
  data: {},
  ...extra,
});

const endpoint = (id: string, method: string, path: string, spec: DocInput = {}) => ({
  id,
  type: 'endpoint',
  position: { x: 0, y: 0 },
  data: { method, path, spec },
});

const table = (id: string, columnIds: string[], extra: DocInput = {}) => ({
  id,
  type: 'table',
  label: id,
  position: { x: 0, y: 0 },
  data: { columns: columnIds.map((c) => ({ id: c, name: c, type: 'uuid' })) },
  ...extra,
});

const link = (id: string, source: string, target: string, kind = 'calls') => ({
  id,
  source,
  target,
  kind,
});

const doc = (patch: DocInput = {}) => ({ ...emptyCanvas(), ...patch });

const issues = (input: DocInput) => {
  const result = CanvasDoc.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('CanvasDoc', () => {
  it('accepts an empty canvas', () => {
    expect(CanvasDoc.parse(emptyCanvas())).toEqual(emptyCanvas());
  });

  it('fills defaults for optional sections and node data', () => {
    const parsed = CanvasDoc.parse({
      schemaVersion: 1,
      nodes: [endpoint('e1', 'GET', '/health', undefined)],
      edges: [],
      flows: [],
    });
    expect(parsed.models).toEqual([]);
    expect(parsed.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    const node = parsed.nodes[0];
    expect(node?.type === 'endpoint' && node.data.spec.responses).toEqual([
      { status: '200', description: '' },
    ]);
  });

  it('rejects duplicate node ids', () => {
    expect(issues(doc({ nodes: [screen('a'), screen('a')] }))).toContain('Duplicate node ids');
  });

  it('rejects duplicate edge ids', () => {
    const nodes = [screen('a'), screen('b')];
    const edges = [link('x', 'a', 'b', 'navigates'), link('x', 'b', 'a', 'navigates')];
    expect(issues(doc({ nodes, edges }))).toContain('Duplicate edge ids');
  });

  it('requires parents to be frames', () => {
    const nodes = [screen('a'), screen('b', { parentId: 'a' })];
    expect(issues(doc({ nodes }))).toContain('Parent a is missing or not a frame');

    const frame = { id: 'f', type: 'frame', position: { x: 0, y: 0 }, data: {} };
    expect(issues(doc({ nodes: [frame, screen('b', { parentId: 'f' })] }))).toEqual([]);
  });

  it('rejects edges to missing nodes', () => {
    const edges = [link('x', 'a', 'missing', 'navigates')];
    expect(issues(doc({ nodes: [screen('a')], edges }))).toContain('Edge references a missing node');
  });

  it('requires FK edges to connect existing columns of two tables', () => {
    const fk = (source: string, target: string, sourceColumnId: string, targetColumnId: string) => ({
      id: 'fk',
      source,
      target,
      kind: 'fk',
      data: { sourceColumnId, targetColumnId },
    });
    const nodes = [table('orders', ['id', 'user_id']), table('users', ['id']), screen('s')];

    expect(issues(doc({ nodes, edges: [fk('orders', 'users', 'user_id', 'id')] }))).toEqual([]);
    expect(issues(doc({ nodes, edges: [fk('orders', 's', 'user_id', 'id')] }))).toContain(
      'FK edges must connect two tables',
    );
    expect(issues(doc({ nodes, edges: [fk('orders', 'users', 'nope', 'nope')] }))).toEqual([
      'Unknown source column',
      'Unknown target column',
    ]);
  });

  it('allows CRUD operations only on table connections, without repeats', () => {
    const nodes = [screen('s'), endpoint('e', 'POST', '/orders'), table('t', ['id'])];
    const crud = (edge: ReturnType<typeof link>, ops: string[]) => ({ ...edge, crud: ops });
    expect(issues(doc({ nodes, edges: [crud(link('w', 'e', 't', 'writes'), ['create', 'update'])] }))).toEqual([]);
    expect(issues(doc({ nodes, edges: [crud(link('r', 't', 'e', 'reads'), ['read'])] }))).toEqual([]);
    expect(issues(doc({ nodes, edges: [crud(link('c', 's', 'e'), ['read'])] }))).toEqual([
      'CRUD operations need a table on one end',
    ]);
    expect(issues(doc({ nodes, edges: [crud(link('d', 'e', 't', 'writes'), ['read', 'read'])] }))).toEqual([
      'Duplicate CRUD operation',
    ]);
  });

  describe('tables', () => {
    it('requires a table name, unique per schema (case-insensitive)', () => {
      expect(issues(doc({ nodes: [table('t', ['id'], { label: '  ' })] }))).toEqual(['Table name is required']);
      expect(issues(doc({ nodes: [table('a', ['id'], { label: 'users' }), table('b', ['id'], { label: 'Users' })] })))
        .toEqual(['Duplicate table Users']);

      const other = { label: 'users', data: { schema: 'auth', columns: [] } };
      expect(issues(doc({ nodes: [table('a', ['id'], { label: 'users' }), table('b', [], other)] }))).toEqual([]);
    });

    it('requires unique column names and ids', () => {
      const columns = [
        { id: 'c1', name: 'email', type: 'text' },
        { id: 'c2', name: 'Email', type: 'text' },
        { id: 'c2', name: 'name', type: 'text' },
      ];
      const result = CanvasDoc.safeParse(doc({ nodes: [table('t', [], { data: { columns } })] }));
      expect(result.error?.issues.map((i) => [i.path, i.message])).toEqual([
        [['nodes', 0, 'data', 'columns', 1, 'name'], 'Duplicate column Email'],
        [['nodes', 0, 'data', 'columns', 2], 'Duplicate column id'],
      ]);
    });

    it('requires index columns to exist', () => {
      const data = {
        columns: [{ id: 'c1', name: 'email', type: 'text' }],
        indexes: [{ id: 'i', columnIds: ['c1', 'gone'] }],
      };
      const result = CanvasDoc.safeParse(doc({ nodes: [table('t', [], { data })] }));
      expect(result.error?.issues.map((i) => [i.path, i.message])).toEqual([
        [['nodes', 0, 'data', 'indexes', 0, 'columnIds', 1], 'Index references an unknown column'],
      ]);
    });
  });

  describe('frames and sketches', () => {
    const frame = (id: string, extra: object = {}) => ({ id, type: 'frame', position: { x: 0, y: 0 }, data: {}, ...extra });
    const sketch = (id: string, data: object, extra: object = {}) => ({ id, type: 'sketch', position: { x: 0, y: 0 }, data, ...extra });

    it('lets nodes and sketches sit in a frame, but not frames in frames', () => {
      expect(issues(doc({ nodes: [frame('f'), screen('s', { parentId: 'f' }), sketch('n', { shape: 'sticky' }, { parentId: 'f' })] }))).toEqual([]);
      expect(issues(doc({ nodes: [frame('f'), frame('g', { parentId: 'f' })] }))).toEqual(['Frames cannot be inside other frames']);
    });

    it('needs at least two points for a pen stroke', () => {
      expect(issues(doc({ nodes: [sketch('p', { shape: 'freehand', points: [[0, 0, 0.5], [4, 4, 0.5]] })] }))).toEqual([]);
      expect(issues(doc({ nodes: [sketch('p', { shape: 'freehand', points: [[0, 0, 0.5]] })] }))).toEqual([
        'A pen stroke needs at least two points',
      ]);
    });
  });

  describe('screen wireframes', () => {
    const el = (id: string, rect = { x: 0, y: 0, w: 12, h: 4 }) => ({ id, kind: 'button', rect, text: 'Go' });
    const withWireframe = (wireframe: unknown) => doc({ nodes: [screen('s', { data: { wireframe } })] });

    it('is optional and fills defaults', () => {
      expect(issues(doc({ nodes: [screen('s')] }))).toEqual([]);
      const node = CanvasDoc.parse(withWireframe({})).nodes[0];
      expect(node?.type === 'screen' && node.data.wireframe).toEqual({ device: 'desktop', elements: [] });
    });

    it('requires unique element ids', () => {
      const result = CanvasDoc.safeParse(withWireframe({ elements: [el('a'), el('b'), el('a')] }));
      expect(result.error?.issues.map((i) => [i.path, i.message])).toEqual([
        [['nodes', 0, 'data', 'wireframe', 'elements', 2, 'id'], 'Duplicate element id'],
      ]);
    });

    it('keeps elements on the 12-column grid', () => {
      expect(issues(withWireframe({ elements: [el('a', { x: 6, y: 0, w: 6, h: 1 })] }))).toEqual([]);
      expect(issues(withWireframe({ elements: [el('a', { x: 7, y: 0, w: 6, h: 1 })] }))).toEqual([
        'Element is wider than the 12-column grid',
      ]);
      expect(issues(withWireframe({ elements: [el('a', { x: 0, y: 0, w: 0, h: 1 })] }))).toHaveLength(1);
      expect(issues(withWireframe({ elements: [el('a', { x: 0.5, y: 0, w: 1, h: 1 })] }))).toHaveLength(1);
    });

    it('lets links start at interactive elements of the source screen only', () => {
      const wireframe = { elements: [el('go'), { id: 'pic', kind: 'image', rect: { x: 0, y: 4, w: 4, h: 4 } }] };
      const nodes = [screen('s', { data: { wireframe } }), endpoint('e', 'POST', '/orders'), screen('other')];
      const from = (handle: string, source = 's') => doc({ nodes, edges: [{ ...link('l', source, 'e'), sourceHandle: handle }] });

      expect(issues(from('el:go'))).toEqual([]);
      expect(issues(from('el:go:r'))).toEqual([]);
      expect(issues(from('el:gone'))).toEqual(['Unknown screen element']);
      expect(issues(from('el:go', 'other'))).toEqual(['Unknown screen element']);
      expect(issues(from('el:pic'))).toEqual(['Only buttons, links, forms and lists can start a connection']);
      expect(issues(doc({ nodes, edges: [{ ...link('l', 'e', 's'), targetHandle: 'el:go' }] }))).toEqual([
        'A screen element cannot be a target',
      ]);
    });

    it('parses element handle ids', () => {
      expect(elementHandleId('abc')).toBe('el:abc');
      expect(elementIdOf('el:abc')).toBe('abc');
      expect(elementIdOf('el:abc:l')).toBe('abc');
      expect(elementIdOf('col:abc:l')).toBeNull();
      expect(elementIdOf(undefined)).toBeNull();
    });

    it('places existing components on screens only', () => {
      const instance = (componentId?: string) => ({ id: 'i', kind: 'instance', rect: { x: 0, y: 0, w: 12, h: 4 }, componentId });
      const component = (elements: unknown[] = []) => ({
        id: 'c',
        type: 'component',
        label: 'Card',
        position: { x: 0, y: 0 },
        data: { wireframe: { elements } },
      });
      const page = (el: unknown) => screen('s', { data: { wireframe: { elements: [el] } } });

      expect(issues(doc({ nodes: [component(), page(instance('c'))] }))).toEqual([]);
      expect(issues(doc({ nodes: [component(), page(instance('s'))] }))).toEqual(['Unknown component s']);
      expect(issues(doc({ nodes: [component(), page(instance())] }))).toEqual(['Pick a component']);
      expect(issues(doc({ nodes: [component(), page({ ...instance(), kind: 'button', componentId: 'c' })] }))).toEqual([
        'Only component instances name a component',
      ]);
      expect(issues(doc({ nodes: [component([instance('c')])] }))).toEqual(['Components cannot contain other components']);
    });

    it('lists the screens that place a component', () => {
      const d = CanvasDoc.parse(
        doc({
          nodes: [
            { id: 'c', type: 'component', label: 'Card', position: { x: 0, y: 0 }, data: {} },
            screen('s', { label: 'Shop', data: { wireframe: { elements: [{ id: 'i', kind: 'instance', componentId: 'c', rect: { x: 0, y: 0, w: 12, h: 4 } }] } } }),
            screen('t'),
          ],
        }),
      );
      expect(componentUsages(d, 'c')).toEqual(['Shop']);
      expect(wireComponentsOf(d).get('c')).toEqual({ name: 'Card', wireframe: undefined });
    });

    it('binds forms, lists and tables to existing models only', () => {
      const models = [{ id: 'm', name: 'OrderDto', fields: [] }];
      const bound = (kind: string, modelRef: string) =>
        doc({ models, nodes: [screen('s', { data: { wireframe: { elements: [{ id: 'a', kind, rect: { x: 0, y: 0, w: 12, h: 4 }, modelRef }] } } })] });

      expect(issues(bound('form', 'm'))).toEqual([]);
      expect(issues(bound('table', 'm'))).toEqual([]);
      expect(issues(bound('list', 'gone'))).toEqual(['Unknown model gone']);
      expect(issues(bound('button', 'm'))).toEqual(['Only forms, lists and tables can show a model']);
    });

    it('measures its height in rows', () => {
      expect(wireframeRows({ elements: [] })).toBe(0);
      const elements = [el('a', { x: 0, y: 0, w: 12, h: 6 }), el('b', { x: 0, y: 10, w: 4, h: 5 })];
      expect(wireframeRows(Wireframe.parse({ elements }))).toBe(15);
    });
  });

  describe('flows', () => {
    const nodes = [screen('s'), endpoint('e', 'POST', '/orders'), table('t', ['id']), screen('other')];
    const edges = [
      link('s-e', 's', 'e'),
      link('e-t', 'e', 't', 'writes'),
      link('e-o', 'e', 'other', 'emits'),
      link('o-s', 'other', 's', 'navigates'),
    ];
    const flow = (edgeIds: string[]) => ({
      id: 'f',
      name: 'Checkout',
      steps: edgeIds.map((edgeId) => ({ edgeId })),
    });

    it('allows branching from any reached node', () => {
      expect(issues(doc({ nodes, edges, flows: [flow(['s-e', 'e-t', 'e-o'])] }))).toEqual([]);
    });

    it('allows a two-way pair as request then response', () => {
      const back = link('t-e', 't', 'e', 'reads');
      expect(issues(doc({ nodes, edges: [...edges, back], flows: [flow(['s-e', 'e-t', 't-e'])] }))).toEqual([]);
    });

    it('rejects unknown edges', () => {
      expect(issues(doc({ nodes, edges, flows: [flow(['s-e', 'nope'])] }))).toContain('Unknown edge');
    });

    it('allows empty flows (created before recording)', () => {
      expect(issues(doc({ nodes, edges, flows: [flow([])] }))).toEqual([]);
    });

    it('rejects an edge used twice in one flow', () => {
      expect(issues(doc({ nodes, edges, flows: [flow(['s-e', 'e-t', 's-e'])] }))).toEqual([
        'This edge is already in the flow',
      ]);
    });

    it('canAppendStep explains why a step cannot be added', () => {
      const d = { edges: edges as never };
      expect(canAppendStep(d, [], 'o-s')).toEqual({ ok: true });
      expect(canAppendStep(d, [{ edgeId: 's-e' }], 'e-o')).toEqual({ ok: true });
      expect(canAppendStep(d, [{ edgeId: 's-e' }], 'o-s')).toEqual({
        ok: false,
        reason: 'Step does not continue from a node already in the flow',
      });
      expect(canAppendStep(d, [{ edgeId: 's-e' }], 's-e')).toMatchObject({ ok: false });
      expect(canAppendStep(d, [], 'nope')).toEqual({ ok: false, reason: 'Unknown edge' });
    });

    it('rejects steps that do not continue from a reached node', () => {
      expect(issues(doc({ nodes, edges, flows: [flow(['s-e', 'o-s'])] }))).toContain(
        'Step does not continue from a node already in the flow',
      );
    });
  });

  describe('API', () => {
    const model = (id: string, name: string, fields: DocInput[] = []) => ({ id, name, fields });
    const refField = (modelId: string) => ({ id: `f-${modelId}`, name: 'ref', type: { kind: 'ref', modelId } });

    it('requires unique model names', () => {
      expect(issues(doc({ models: [model('a', 'Order'), model('b', 'Order')] }))).toEqual(['Duplicate model Order']);
    });

    it('requires model references to resolve', () => {
      expect(issues(doc({ models: [model('a', 'Order', [refField('missing')])] }))).toContain(
        'Unknown model missing',
      );
      expect(issues(doc({ models: [model('a', 'Order', [refField('a')])] }))).toEqual([]);
    });

    it('requires endpoint body and response refs to resolve', () => {
      const nodes = [
        endpoint('e', 'POST', '/orders', {
          requestBody: { type: { kind: 'ref', modelId: 'in' } },
          responses: [{ status: '201', body: { kind: 'array', items: { kind: 'ref', modelId: 'out' } } }],
        }),
      ];
      expect(issues(doc({ nodes }))).toEqual(['Unknown model in', 'Unknown model out']);
    });

    it('requires unique field names within a model', () => {
      const field = (id: string, name: string) => ({ id, name, type: { kind: 'primitive', type: 'string' } });
      expect(issues(doc({ models: [model('a', 'Order', [field('1', 'id'), field('2', 'id')])] }))).toEqual([
        'Duplicate field id',
      ]);
    });

    it('rejects routes that differ only in path param names', () => {
      const param = (name: string) => ({ id: name, name, in: 'path', type: { kind: 'primitive', type: 'string' } });
      const nodes = [
        endpoint('a', 'GET', '/orders/{id}', { params: [param('id')] }),
        endpoint('b', 'GET', '/orders/{orderId}', { params: [param('orderId')] }),
        endpoint('c', 'DELETE', '/orders/{orderId}', { params: [param('orderId')] }),
      ];
      expect(issues(doc({ nodes }))).toEqual(['GET /orders/{orderId} is the same route as GET /orders/{id}']);
    });

    it('requires unique operationIds, including generated ones', () => {
      const nodes = [endpoint('a', 'GET', '/order-items'), endpoint('b', 'GET', '/order/items')];
      expect(issues(doc({ nodes }))).toEqual(['Duplicate operationId getOrderItems']);
      // A duplicate route doesn't also report its (equally duplicate) generated operationId
      expect(issues(doc({ nodes: [endpoint('a', 'GET', '/orders'), endpoint('b', 'GET', '/orders')] }))).toEqual([
        'Duplicate route GET /orders',
      ]);
      const custom = [endpoint('a', 'GET', '/a', { operationId: 'list' }), endpoint('b', 'GET', '/b', { operationId: 'list' })];
      expect(issues(doc({ nodes: custom }))).toEqual(['Duplicate operationId list']);
    });

    it('requires unique params (per location) and response statuses', () => {
      const q = (id: string, name: string, location = 'query') => ({ id, name, in: location, type: { kind: 'primitive', type: 'string' } });
      const nodes = [
        endpoint('e', 'GET', '/search', {
          params: [q('1', 'q'), q('2', 'q'), q('3', 'q', 'header'), q('4', 'X-Trace', 'header'), q('5', 'x-trace', 'header')],
          responses: [{ status: '200' }, { status: '200' }],
        }),
      ];
      expect(issues(doc({ nodes }))).toEqual([
        'Duplicate query parameter q',
        'Duplicate header parameter x-trace',
        'Duplicate response 200',
      ]);
    });

    it('rejects duplicate routes', () => {
      const nodes = [endpoint('a', 'GET', '/orders'), endpoint('b', 'GET', '/orders')];
      expect(issues(doc({ nodes }))).toContain('Duplicate route GET /orders');
      const distinct = [endpoint('a', 'GET', '/orders'), endpoint('b', 'POST', '/orders')];
      expect(issues(doc({ nodes: distinct }))).toEqual([]);
    });

    it('requires path params to match declared path parameters', () => {
      const param = { id: 'p', name: 'orderId', in: 'path', type: { kind: 'primitive', type: 'string' } };
      const message = 'Path params in /orders/{orderId} must match declared path parameters';

      expect(issues(doc({ nodes: [endpoint('e', 'GET', '/orders/{orderId}')] }))).toContain(message);
      expect(
        issues(doc({ nodes: [endpoint('e', 'GET', '/orders/{orderId}', { params: [param] })] })),
      ).toEqual([]);
    });
  });
});
