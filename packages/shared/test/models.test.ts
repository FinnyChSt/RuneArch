import { describe, expect, it } from 'vitest';
import { CanvasDoc, emptyCanvas, modelUsages, typeLabel } from '../src';

const doc = CanvasDoc.parse({
  ...emptyCanvas(),
  models: [
    { id: 'order', name: 'OrderDto', fields: [{ id: 'f', name: 'id', type: { kind: 'primitive', type: 'string' } }] },
    {
      id: 'list',
      name: 'OrderListDto',
      fields: [{ id: 'i', name: 'items', type: { kind: 'array', items: { kind: 'ref', modelId: 'order' } } }],
    },
    // A model may reference itself (e.g. a tree); that doesn't count as a usage elsewhere
    { id: 'node', name: 'NodeDto', fields: [{ id: 'c', name: 'children', type: { kind: 'array', items: { kind: 'ref', modelId: 'node' } } }] },
  ],
  nodes: [
    {
      id: 'e',
      type: 'endpoint',
      position: { x: 0, y: 0 },
      data: {
        method: 'POST',
        path: '/orders',
        spec: {
          requestBody: { type: { kind: 'ref', modelId: 'order' } },
          responses: [{ status: '201', body: { kind: 'ref', modelId: 'order' } }, { status: '400' }],
        },
      },
    },
    {
      id: 's',
      type: 'screen',
      label: 'Checkout',
      position: { x: 0, y: 200 },
      data: {
        wireframe: {
          elements: [
            { id: 'f', kind: 'form', rect: { x: 0, y: 0, w: 12, h: 20 }, text: 'New order', modelRef: 'order' },
            { id: 't', kind: 'table', rect: { x: 0, y: 21, w: 12, h: 17 }, modelRef: 'order' },
          ],
        },
      },
    },
  ],
});

describe('typeLabel', () => {
  it('describes primitives, formats, enums, refs and arrays', () => {
    expect(typeLabel({ kind: 'primitive', type: 'string', format: 'uuid' }, doc.models)).toBe('string (uuid)');
    expect(typeLabel({ kind: 'primitive', type: 'string', enum: ['draft', 'paid'] }, doc.models)).toBe("'draft' | 'paid'");
    expect(typeLabel({ kind: 'array', items: { kind: 'ref', modelId: 'order' } }, doc.models)).toBe('OrderDto[]');
    expect(typeLabel({ kind: 'ref', modelId: 'gone' }, doc.models)).toBe('unknown model');
  });
});

describe('modelUsages', () => {
  it('lists model fields, endpoint bodies/responses and wireframe elements that use a model', () => {
    expect(modelUsages(doc, 'order')).toEqual([
      'OrderListDto.items',
      'POST /orders body',
      'POST /orders 201 response',
      'Checkout · New order',
      'Checkout · table',
    ]);
    expect(modelUsages(doc, 'list')).toEqual([]);
    expect(modelUsages(doc, 'node')).toEqual([]);
  });
});
