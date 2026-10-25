import { describe, expect, it } from 'vitest';
import { CanvasDoc, defaultOperationId, emptyCanvas, statusText, toOpenApi, toOpenApiYaml } from '../src';

const sampleDoc = () =>
  CanvasDoc.parse({
    ...emptyCanvas(),
    models: [
      {
        id: 'm-order',
        name: 'OrderDto',
        fields: [
          { id: 'f1', name: 'id', type: { kind: 'primitive', type: 'string', format: 'uuid' } },
          { id: 'f2', name: 'note', type: { kind: 'primitive', type: 'string' }, nullable: true, required: false },
          { id: 'f3', name: 'total', type: { kind: 'primitive', type: 'number' }, example: '9.5' },
        ],
      },
    ],
    nodes: [
      {
        id: 'e1',
        type: 'endpoint',
        label: 'Get order',
        position: { x: 0, y: 0 },
        data: {
          method: 'GET',
          path: '/orders/{orderId}',
          spec: {
            tags: ['orders'],
            params: [{ id: 'p1', name: 'orderId', in: 'path', type: { kind: 'primitive', type: 'string' } }],
            responses: [{ status: '200', body: { kind: 'ref', modelId: 'm-order' } }],
          },
        },
      },
      {
        id: 'e2',
        type: 'endpoint',
        position: { x: 0, y: 0 },
        data: { method: 'GET', path: '/health', auth: 'public' },
      },
    ],
  });

describe('defaultOperationId', () => {
  it('builds camelCase ids from method and path', () => {
    expect(defaultOperationId('GET', '/orders/{orderId}')).toBe('getOrdersByOrderId');
    expect(defaultOperationId('POST', '/order-items')).toBe('postOrderItems');
  });
});

describe('toOpenApi', () => {
  const spec = toOpenApi(sampleDoc()) as any;

  it('emits an OpenAPI 3.1 document with global bearer security', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('references models and always requires path params', () => {
    const op = spec.paths['/orders/{orderId}'].get;
    expect(op.operationId).toBe('getOrdersByOrderId');
    expect(op.summary).toBe('Get order');
    expect(op.parameters[0]).toMatchObject({ name: 'orderId', in: 'path', required: true });
    expect(op.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/OrderDto',
    });
  });

  it('maps nullable fields, required lists and examples', () => {
    const schema = spec.components.schemas.OrderDto;
    expect(schema.required).toEqual(['id', 'total']);
    expect(schema.properties.note.type).toEqual(['string', 'null']);
    expect(schema.properties.total.examples).toEqual([9.5]);
  });

  it('describes responses without a description by their status', () => {
    expect(spec.paths['/health'].get.responses['200'].description).toBe('OK');
    expect([statusText('201'), statusText('4XX'), statusText('default'), statusText('418')]).toEqual([
      'Created',
      '4xx response',
      'Default response',
      'Response',
    ]);
  });

  it('lets public endpoints opt out of security', () => {
    expect(spec.paths['/health'].get.security).toEqual([]);
  });

  it('serializes to YAML', () => {
    expect(toOpenApiYaml(sampleDoc())).toContain('openapi: 3.1.0');
  });
});
