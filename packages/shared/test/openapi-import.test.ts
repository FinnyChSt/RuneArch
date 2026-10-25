import { validate } from '@readme/openapi-parser';
import { describe, expect, it } from 'vitest';
import {
  CanvasDoc,
  emptyCanvas,
  groupImportWarnings,
  parseOpenApi,
  specToYaml,
  toOpenApi,
  type ApiSettings,
  type ImportedApi,
} from '../src';
import { kitchenSink } from './fixtures/kitchen-sink';

/** The imported API as a canvas, the way the import into an empty canvas will place it */
const toDoc = (api: ImportedApi) =>
  CanvasDoc.parse({
    ...emptyCanvas(),
    api: api.settings,
    models: api.models,
    nodes: api.endpoints.map((e, i) => ({ id: `ep${i}`, type: 'endpoint', position: { x: 0, y: i * 100 }, data: e })),
  });

const imported = (text: string) => {
  const result = parseOpenApi(text);
  if (!result.ok) throw new Error(result.error);
  return result.api;
};

const texts = (api: ImportedApi) => api.warnings.map((w) => w.text);
const modelOf = (api: ImportedApi, name: string) => api.models.find((m) => m.name === name)!;
const fieldOf = (api: ImportedApi, model: string, field: string) => modelOf(api, model).fields.find((f) => f.name === field)!;
const endpointOf = (api: ImportedApi, route: string) => api.endpoints.find((e) => `${e.method} ${e.path}` === route)!;

describe('round trip with the OpenAPI export', () => {
  it.each<ApiSettings['auth']>(['bearer', 'apiKey', 'none'])('exports, imports and exports the same spec (auth %s)', (auth) => {
    const spec = toOpenApi(kitchenSink(auth));
    for (const text of [JSON.stringify(spec, null, 2), specToYaml(spec)]) {
      const api = imported(text);
      expect(texts(api)).toEqual([]);
      expect(toOpenApi(toDoc(api))).toEqual(spec);
    }
  });
});

const spec30 = `
openapi: 3.0.3
info: { title: Legacy API, version: "2.0", description: Old but gold }
servers: [{ url: "https://legacy.example.com" }]
security: [{ key: [] }]
paths:
  /pets:
    parameters:
      - $ref: "#/components/parameters/Limit"
    get:
      operationId: list-pets
      tags: [pets]
      parameters:
        - { name: session, in: cookie, schema: { type: string } }
        - { name: ids, in: query, schema: { type: array, items: { type: integer, format: int64 } } }
      responses:
        "200":
          description: Pets
          content:
            application/json:
              schema: { type: object, properties: { items: { type: array, items: { $ref: "#/components/schemas/Pet" } }, total: { type: integer } } }
        4xx: { $ref: "#/components/responses/Problem" }
    post:
      operationId: createPet
      security: []
      requestBody:
        $ref: "#/components/requestBodies/NewPet"
      responses:
        "201": { description: Created, content: { application/hal+json: { schema: { $ref: "#/components/schemas/Pet" } } } }
    head:
      responses: { "200": { description: ok } }
  /pets/{petId}/toys/{toyId}:
    get:
      operationId: createPet
      parameters: [{ name: petId, in: path, required: true, schema: { type: string, format: uuid } }]
      responses: {}
components:
  securitySchemes:
    key: { type: apiKey, in: header, name: X-Key }
  parameters:
    Limit: { name: limit, in: query, schema: { type: integer, format: int32, maximum: 100 } }
  requestBodies:
    NewPet:
      required: true
      content: { application/json: { schema: { $ref: "#/components/schemas/NewPet" } } }
  responses:
    Problem:
      description: Something went wrong
      content: { application/problem+json: { schema: { $ref: "#/components/schemas/Error" } } }
  schemas:
    Status: { type: string, enum: [available, sold] }
    Base:
      type: object
      required: [id]
      properties: { id: { type: string, format: uuid }, createdAt: { type: string, format: date-time } }
    Pet:
      description: A pet
      allOf:
        - $ref: "#/components/schemas/Base"
        - type: object
          required: [name]
          properties:
            name: { type: string, example: Rex }
            status: { $ref: "#/components/schemas/Status" }
            owner: { type: object, nullable: true, properties: { email: { type: string, format: email } } }
            weight: { type: number, format: decimal }
            parent: { $ref: "#/components/schemas/Pet" }
            labels: { type: object, additionalProperties: { type: string } }
            grid: { type: array, items: { type: array, items: { type: integer } } }
            kind: { oneOf: [{ type: string }, { type: integer }] }
            meta: { example: { a: 1 } }
    NewPet:
      type: object
      properties: { name: { type: string } }
    Error:
      type: object
      properties: { message: { type: string } }
`;

describe('OpenAPI 3.0', () => {
  const api = imported(spec30);

  it('reads the settings and the security scheme', () => {
    expect(api.version).toBe('3.0');
    expect(api.settings).toMatchObject({
      title: 'Legacy API',
      version: '2.0',
      description: 'Old but gold',
      servers: [{ url: 'https://legacy.example.com' }],
      auth: 'apiKey',
      apiKeyHeader: 'X-Key',
    });
  });

  it('merges allOf, inlines non-object components and hoists inline objects', () => {
    expect(api.models.map((m) => m.name)).toEqual(['Base', 'Pet', 'NewPet', 'Error', 'PetOwner', 'ListPetsResponse']);
    const pet = modelOf(api, 'Pet');
    expect(pet.description).toBe('A pet');
    expect(pet.fields.map((f) => [f.name, f.required])).toEqual([
      ['id', true],
      ['createdAt', false],
      ['name', true],
      ['status', false],
      ['owner', false],
      ['weight', false],
      ['parent', false],
      ['labels', false],
      ['grid', false],
      ['kind', false],
      ['meta', false],
    ]);
    expect(fieldOf(api, 'Pet', 'name').example).toBe('Rex');
    expect(fieldOf(api, 'Pet', 'status').type).toEqual({ kind: 'primitive', type: 'string', enum: ['available', 'sold'] });
    expect(fieldOf(api, 'Pet', 'owner')).toMatchObject({ type: { kind: 'ref', modelId: 'PetOwner' }, nullable: true });
    expect(fieldOf(api, 'PetOwner', 'email').type).toEqual({ kind: 'primitive', type: 'string', format: 'email' });
    expect(fieldOf(api, 'Pet', 'parent').type).toEqual({ kind: 'ref', modelId: 'Pet' });
    expect(fieldOf(api, 'Pet', 'meta').example).toBe('{"a":1}');
  });

  it('approximates what the canvas cannot hold, with a warning', () => {
    expect(fieldOf(api, 'Pet', 'weight').type).toEqual({ kind: 'primitive', type: 'number' });
    for (const field of ['labels', 'grid', 'meta']) expect(fieldOf(api, 'Pet', field).type).toEqual({ kind: 'primitive', type: 'string' });
    expect(fieldOf(api, 'Pet', 'kind').type).toEqual({ kind: 'primitive', type: 'string' });
    expect(texts(api)).toEqual(
      expect.arrayContaining([
        'Schema Pet.weight: format decimal is not supported for number; imported without a format',
        'Schema Pet.labels: map (additionalProperties); imported as a string',
        'Schema Pet.grid: array of arrays; imported as a string',
        'Schema Pet.kind: oneOf/anyOf with 2 options; using the first',
        'Schema Pet.meta: schema without a type; imported as a string',
      ]),
    );
  });

  it('maps operations: params, bodies, responses and their $refs', () => {
    const list = endpointOf(api, 'GET /pets');
    expect(list.spec.operationId).toBe('listPets');
    expect(list.spec.tags).toEqual(['pets']);
    expect(list.spec.params.map((p) => [p.in, p.name, p.type])).toEqual([
      ['query', 'limit', { kind: 'primitive', type: 'integer', format: 'int32' }],
      ['query', 'ids', { kind: 'primitive', type: 'integer', format: 'int64' }],
    ]);
    expect(list.spec.responses).toEqual([
      { status: '200', description: 'Pets', body: { kind: 'ref', modelId: 'ListPetsResponse' } },
      { status: '4XX', description: 'Something went wrong', body: { kind: 'ref', modelId: 'Error' } },
    ]);
    expect(fieldOf(api, 'ListPetsResponse', 'items').type).toEqual({ kind: 'array', items: { kind: 'ref', modelId: 'Pet' } });

    const create = endpointOf(api, 'POST /pets');
    expect(create.auth).toBe('public');
    expect(create.spec.requestBody).toEqual({ contentType: 'application/json', type: { kind: 'ref', modelId: 'NewPet' }, required: true });
    expect(create.spec.responses[0]!.body).toEqual({ kind: 'ref', modelId: 'Pet' });
    expect(list.auth).toBe('user');
  });

  it('fixes or skips what would break the canvas rules', () => {
    const toys = endpointOf(api, 'GET /pets/{petId}/toys/{toyId}');
    // createPet is taken by POST /pets
    expect(toys.spec.operationId).toBeUndefined();
    expect(toys.spec.params.map((p) => [p.name, p.required])).toEqual([
      ['petId', true],
      ['toyId', true],
    ]);
    expect(toys.spec.responses).toEqual([{ status: '200', description: '' }]);
    // HEAD is skipped
    expect(api.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /pets', 'POST /pets', 'GET /pets/{petId}/toys/{toyId}']);
    expect(texts(api)).toEqual(
      expect.arrayContaining([
        'GET /pets: operationId list-pets renamed to listPets',
        'GET /pets: cookie parameter session skipped',
        'GET /pets parameter ids: array parameter; imported as its item type',
        'HEAD /pets: method not supported; skipped',
        'GET /pets/{petId}/toys/{toyId}: duplicate operationId createPet dropped',
        'GET /pets/{petId}/toys/{toyId}: path parameter toyId not declared; added as a string',
        'GET /pets/{petId}/toys/{toyId}: no responses; added 200',
      ]),
    );
  });

  it('groups warnings by kind, in a fixed order', () => {
    const groups = groupImportWarnings(api.warnings);
    expect(groups.map((g) => g.kind)).toEqual(['skipped', 'as-string', 'union', 'format', 'parameter', 'operation-id', 'filled-in']);
    expect(groups.find((g) => g.kind === 'operation-id')).toMatchObject({
      title: 'operationIds renamed or dropped',
      warnings: [
        { where: 'GET /pets', message: 'operationId list-pets renamed to listPets' },
        { where: 'GET /pets/{petId}/toys/{toyId}', message: 'duplicate operationId createPet dropped' },
      ],
    });
    expect(groups.flatMap((g) => g.warnings)).toHaveLength(api.warnings.length);
  });

  it('gives a doc that passes the canvas rules', () => {
    expect(() => toDoc(api)).not.toThrow();
  });
});

const spec31 = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Modern API', version: '1.0.0' },
  security: [{ oauth: ['read'] }],
  webhooks: { newOrder: {} },
  paths: {
    '/orders/{id}': {
      get: {
        'x-required-role': 'admin',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          default: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'integer' } } } } } },
          '200': { description: 'The order', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
        },
      },
    },
  },
  components: {
    securitySchemes: { oauth: { type: 'oauth2', flows: {} } },
    schemas: {
      Order: {
        type: 'object',
        required: ['id', 'note'],
        properties: {
          id: { type: 'integer', format: 'int64' },
          note: { type: ['string', 'null'], examples: ['Leave at the door'] },
          customer: { anyOf: [{ $ref: '#/components/schemas/Customer' }, { type: 'null' }] },
          kind: { const: 'order' },
          lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } } } },
        },
      },
      Customer: { type: 'object', properties: { name: { type: 'string' } } },
      'order-line.v2': { type: 'object', properties: {} },
    },
  },
});

describe('OpenAPI 3.1', () => {
  const api = imported(spec31);

  it('reads 3.1 nullability, examples and const', () => {
    expect(api.version).toBe('3.1');
    expect(fieldOf(api, 'Order', 'note')).toMatchObject({ type: { kind: 'primitive', type: 'string' }, nullable: true, required: true, example: 'Leave at the door' });
    expect(fieldOf(api, 'Order', 'customer')).toMatchObject({ type: { kind: 'ref', modelId: 'Customer' }, nullable: true });
    expect(fieldOf(api, 'Order', 'kind').type).toEqual({ kind: 'primitive', type: 'string', enum: ['order'] });
    expect(fieldOf(api, 'Order', 'lines').type).toEqual({ kind: 'array', items: { kind: 'ref', modelId: 'OrderLinesItem' } });
  });

  it('names models from any schema key and responses by status', () => {
    expect(api.models.map((m) => m.name)).toEqual(['Order', 'Customer', 'OrderLineV2', 'OrderLinesItem', 'GetOrdersByIdDefaultResponse']);
    const get = endpointOf(api, 'GET /orders/{id}');
    expect(get.auth).toBe('admin');
    // JS objects put integer-like keys first, whatever order the document lists them in
    expect(get.spec.responses.map((r) => r.status)).toEqual(['200', 'default']);
  });

  it('reads other security schemes as bearer and skips webhooks, with warnings', () => {
    expect(api.settings.auth).toBe('bearer');
    expect(texts(api)).toEqual(
      expect.arrayContaining(['Security scheme oauth: oauth2 is not supported; imported as bearer', 'Document: webhooks skipped']),
    );
  });

  it('exports a valid spec again', async () => {
    const result = await validate(structuredClone(toOpenApi(toDoc(api))) as never);
    expect(result.valid).toBe(true);
  });
});

describe('documents that cannot be imported', () => {
  it.each([
    ['openapi: [', /^Not valid JSON or YAML/],
    ['{"openapi": ', /^Not valid JSON or YAML/],
    ['swagger: "2.0"\ninfo: {}', /^Swagger 2\.0 is not supported/],
    ['title: no spec', /^Not an OpenAPI 3 document/],
    ['- a list', /^Not an OpenAPI document/],
  ])('%j', (text, error) => {
    const result = parseOpenApi(text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(error);
  });

  it('warns about external and broken refs', () => {
    const api = imported(
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Refs', version: '1' },
        paths: {
          '/a': {
            get: {
              responses: {
                '200': { description: 'ok', content: { 'application/json': { schema: { $ref: 'other.yaml#/Thing' } } } },
                '404': { description: 'no', content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } },
              },
            },
          },
        },
      }),
    );
    expect(texts(api)).toEqual(
      expect.arrayContaining([
        'GET /a 200 response: external $ref other.yaml#/Thing skipped',
        'GET /a 404 response: $ref #/components/schemas/Missing not found',
      ]),
    );
    expect(api.endpoints[0]!.spec.responses.map((r) => r.body)).toEqual([
      { kind: 'primitive', type: 'string' },
      { kind: 'primitive', type: 'string' },
    ]);
  });
});
