import { CanvasDoc, emptyCanvas, WIRE_COLUMNS, Wireframe, type ApiModel } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import type { NodeOf } from '../../canvas/mapping';
import { collectionFromEndpoint, endpointSources, formFromEndpoint, humanize, modelTitle } from './fromApi';

const str = { kind: 'primitive', type: 'string' } as const;
const models: ApiModel[] = [
  {
    id: 'create',
    name: 'CreateOrderDto',
    fields: [
      { id: '1', name: 'id', type: { ...str, format: 'uuid' }, required: true, nullable: false },
      { id: '2', name: 'firstName', type: str, required: true, nullable: false },
      { id: '3', name: 'shipping', type: { ...str, enum: ['standard', 'express'] }, required: true, nullable: false },
      { id: '4', name: 'giftWrap', type: { kind: 'primitive', type: 'boolean' }, required: true, nullable: false },
      { id: '5', name: 'notes', type: str, required: false, nullable: false },
    ],
  },
  {
    id: 'order',
    name: 'OrderDto',
    fields: [
      { id: 'a', name: 'id', type: str, required: true, nullable: false },
      { id: 'b', name: 'total_price', type: { kind: 'primitive', type: 'number' }, required: true, nullable: false },
      { id: 'c', name: 'customer', type: { kind: 'ref', modelId: 'create' }, required: true, nullable: false },
    ],
  },
  {
    id: 'page',
    name: 'OrderPage',
    fields: [
      { id: 'i', name: 'items', type: { kind: 'array', items: { kind: 'ref', modelId: 'order' } }, required: true, nullable: false },
    ],
  },
];

const endpoint = (method: string, spec: object) =>
  CanvasDoc.parse({
    ...emptyCanvas(),
    models,
    nodes: [{ id: 'e', type: 'endpoint', position: { x: 0, y: 0 }, data: { method, path: '/orders', spec } }],
  }).nodes[0] as NodeOf<'endpoint'>;

const post = endpoint('POST', {
  requestBody: { type: { kind: 'ref', modelId: 'create' } },
  responses: [{ status: '201', body: { kind: 'ref', modelId: 'order' } }],
});

let n = 0;
const ids = () => `id${++n}`;

describe('names', () => {
  it('turns field and model names into labels', () => {
    expect(humanize('firstName')).toBe('First name');
    expect(humanize('total_price')).toBe('Total price');
    expect(modelTitle(models[0]!)).toBe('Create order');
  });
});

describe('endpointSources', () => {
  it('finds the request model and a list of models in a success response', () => {
    const list = endpoint('GET', { responses: [{ status: '200', body: { kind: 'array', items: { kind: 'ref', modelId: 'order' } } }] });
    expect(endpointSources(list, models).response.model?.id).toBe('order');
    expect(endpointSources(list, models).request).toEqual({ model: null, reason: 'The endpoint has no request body' });
  });

  it('looks inside a wrapper model for its list field', () => {
    const paged = endpoint('GET', { responses: [{ status: '200', body: { kind: 'ref', modelId: 'page' } }] });
    expect(endpointSources(paged, models).response.model?.id).toBe('order');
  });

  it('explains why a source is missing', () => {
    const sources = endpointSources(post, models);
    expect(sources.request.model?.id).toBe('create');
    // A single order is not a list; error responses don't count
    expect(sources.response.model).toBeNull();
    const primitive = endpoint('POST', { requestBody: { type: str }, responses: [{ status: '400', body: { kind: 'array', items: { kind: 'ref', modelId: 'order' } } }] });
    expect(endpointSources(primitive, models).request).toEqual({ model: null, reason: 'The request body is not a model' });
    expect(endpointSources(primitive, models).response.model).toBeNull();
  });
});

describe('formFromEndpoint', () => {
  const existing = Wireframe.parse({ elements: [{ id: 'h', kind: 'header', rect: { x: 0, y: 0, w: 12, h: 7 } }] });

  it('adds a form box with one control per field and a submit button linked to the endpoint', () => {
    const { wireframe, links } = formFromEndpoint(existing, post, models[0]!, ids);
    const added = wireframe.elements.slice(1);
    expect(added.map((e) => [e.kind, e.text])).toEqual([
      ['form', 'Create order'],
      ['input', 'First name'],
      ['select', 'Shipping'],
      ['checkbox', 'Gift wrap'],
      ['textarea', 'Notes'],
      ['button', 'Create'],
    ]);
    const [form, , select, , , button] = added;
    expect(form?.modelRef).toBe('create');
    expect(select?.items).toEqual(['standard', 'express']);
    expect(links).toEqual([{ id: expect.any(String), elementId: button!.id, targetId: 'e' }]);

    // Below the header, and the box holds every field
    expect(form?.rect.y).toBe(8);
    for (const el of added.slice(1)) {
      expect(el.rect.y).toBeGreaterThan(form!.rect.y);
      expect(el.rect.y + el.rect.h).toBeLessThan(form!.rect.y + form!.rect.h);
    }
    expect(() => Wireframe.parse(wireframe)).not.toThrow();
  });

  it('uses the endpoint summary as the title and a full-width button on mobile', () => {
    const summarized = { ...post, data: { ...post.data, spec: { ...post.data.spec, summary: 'Checkout' } } };
    const { wireframe } = formFromEndpoint({ device: 'mobile', elements: [] }, summarized, models[0]!, ids);
    expect(wireframe.elements[0]).toMatchObject({ kind: 'form', text: 'Checkout', rect: { y: 0 } });
    expect(wireframe.elements.at(-1)?.rect).toMatchObject({ x: 1, w: 10 });
  });
});

describe('collectionFromEndpoint', () => {
  it('adds a table with a column per scalar field', () => {
    const { wireframe, links } = collectionFromEndpoint({ device: 'desktop', elements: [] }, models[1]!, 'table', ids);
    expect(wireframe.elements).toEqual([
      { id: expect.any(String), kind: 'table', items: ['Id', 'Total price'], modelRef: 'order', rect: { x: 0, y: 0, w: WIRE_COLUMNS, h: 17 } },
    ]);
    expect(links).toEqual([]);
  });

  it('adds a list with sample rows', () => {
    const { wireframe } = collectionFromEndpoint({ device: 'desktop', elements: [] }, models[1]!, 'list', ids);
    expect(wireframe.elements[0]).toMatchObject({ kind: 'list', items: ['Order 1', 'Order 2', 'Order 3'], modelRef: 'order' });
  });
});
