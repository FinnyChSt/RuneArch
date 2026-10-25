import { CanvasDoc, emptyCanvas, type ApiSettings } from '../../src';

/** A doc that exercises every schema feature the API designer can produce (OpenAPI validation and import round trip) */
export const str = { kind: 'primitive', type: 'string' } as const;
const param = (name: string, location: 'path' | 'query' | 'header', extra = {}) => ({
  id: `${location}-${name}`,
  name,
  in: location,
  type: str,
  ...extra,
});

export function kitchenSink(auth: ApiSettings['auth'] = 'bearer'): CanvasDoc {
  return CanvasDoc.parse({
    ...emptyCanvas(),
    api: {
      title: 'Shop API',
      version: '1.2.0',
      description: 'Everything the designer can express',
      servers: [{ url: 'https://api.example.com', description: 'Production' }, { url: 'http://localhost:3000' }],
      auth,
      apiKeyHeader: 'X-API-Key',
    },
    models: [
      {
        id: 'address',
        name: 'AddressDto',
        fields: [
          { id: 'a1', name: 'street', type: str, example: 'Main St 1' },
          { id: 'a2', name: 'zip', type: { kind: 'primitive', type: 'string' }, required: false },
        ],
      },
      {
        id: 'order',
        name: 'OrderDto',
        description: 'An order',
        fields: [
          { id: 'o1', name: 'id', type: { kind: 'primitive', type: 'string', format: 'uuid' } },
          { id: 'o2', name: 'status', type: { kind: 'primitive', type: 'string', enum: ['draft', 'paid'] } },
          { id: 'o3', name: 'total', type: { kind: 'primitive', type: 'number', format: 'double' }, example: '9.5' },
          { id: 'o4', name: 'items', type: { kind: 'primitive', type: 'integer', format: 'int32' }, nullable: true },
          { id: 'o5', name: 'paid', type: { kind: 'primitive', type: 'boolean' }, example: 'true' },
          { id: 'o6', name: 'createdAt', type: { kind: 'primitive', type: 'string', format: 'date-time' } },
          { id: 'o7', name: 'shipping', type: { kind: 'ref', modelId: 'address' }, nullable: true },
          { id: 'o8', name: 'history', type: { kind: 'array', items: { kind: 'ref', modelId: 'address' } } },
          { id: 'o9', name: 'tags', type: { kind: 'array', items: str }, description: 'Free labels' },
        ],
      },
      {
        id: 'create',
        name: 'CreateOrderDto',
        fields: [{ id: 'c1', name: 'shipping', type: { kind: 'ref', modelId: 'address' } }],
      },
    ],
    nodes: [
      {
        id: 'list',
        type: 'endpoint',
        position: { x: 0, y: 0 },
        data: {
          method: 'GET',
          path: '/orders',
          spec: {
            summary: 'List orders',
            tags: ['orders'],
            params: [
              param('limit', 'query', { type: { kind: 'primitive', type: 'integer', format: 'int32' } }),
              param('X-Trace', 'header', { description: 'Trace id' }),
            ],
            responses: [{ status: '200', body: { kind: 'array', items: { kind: 'ref', modelId: 'order' } } }],
          },
        },
      },
      {
        id: 'create',
        type: 'endpoint',
        position: { x: 0, y: 0 },
        data: {
          method: 'POST',
          path: '/orders',
          auth: 'admin',
          spec: {
            tags: ['orders', 'admin'],
            operationId: 'createOrder',
            requestBody: { type: { kind: 'ref', modelId: 'create' } },
            responses: [
              { status: '201', body: { kind: 'ref', modelId: 'order' } },
              { status: '400', description: 'Invalid order' },
              { status: '5XX' },
            ],
          },
        },
      },
      {
        id: 'get',
        type: 'endpoint',
        position: { x: 0, y: 0 },
        data: {
          method: 'GET',
          path: '/orders/{orderId}',
          spec: {
            params: [param('orderId', 'path'), param('orderId', 'query')],
            responses: [{ status: '200', body: { kind: 'ref', modelId: 'order' } }, { status: 'default' }],
            deprecated: true,
          },
        },
      },
      {
        id: 'items',
        type: 'endpoint',
        position: { x: 0, y: 0 },
        data: {
          method: 'PUT',
          path: '/orders/{orderId}/items/{itemId}',
          spec: {
            params: [param('orderId', 'path'), param('itemId', 'path')],
            requestBody: { contentType: 'text/plain', type: str, required: false },
            responses: [{ status: '204' }],
          },
        },
      },
      {
        id: 'health',
        type: 'endpoint',
        position: { x: 0, y: 0 },
        data: { method: 'GET', path: '/health', auth: 'public' },
      },
    ],
  });
}
