import { z } from 'zod';
import type { TableNode } from './canvas';

const Id = z.string().min(1);

/* ============================================================
 * Field types — deliberately flat.
 * Nesting is expressed by referencing another model, which keeps
 * the dialogs simple and maps 1:1 to OpenAPI components.
 * ============================================================ */

export const PrimitiveType = z.object({
  kind: z.literal('primitive'),
  type: z.enum(['string', 'integer', 'number', 'boolean']),
  format: z
    .enum(['uuid', 'email', 'uri', 'date', 'date-time', 'int32', 'int64', 'float', 'double'])
    .optional(),
  enum: z.array(z.string()).optional(),
});

export const RefType = z.object({
  kind: z.literal('ref'),
  modelId: Id,
});

export const ArrayType = z.object({
  kind: z.literal('array'),
  items: z.discriminatedUnion('kind', [PrimitiveType, RefType]),
});

export const FieldType = z.discriminatedUnion('kind', [PrimitiveType, RefType, ArrayType]);

export const Field = z.object({
  id: Id,
  name: z.string().min(1),
  type: FieldType,
  required: z.boolean().default(true),
  nullable: z.boolean().default(false),
  description: z.string().optional(),
  example: z.string().optional(), // raw text, coerced on export
});

/* ============================================================
 * Models (DTOs) — separate from DB tables on purpose
 * ============================================================ */

export const ApiModel = z.object({
  id: Id,
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Use an identifier like CreateOrderDto'),
  description: z.string().optional(),
  fields: z.array(Field).default([]),
  /** Set when generated from a table, so the UI can offer "sync with table" */
  sourceTableId: Id.optional(),
});

/* ============================================================
 * Endpoint spec — lives inside EndpointNode.data.spec
 * ============================================================ */

export const Param = z.object({
  id: Id,
  name: z.string().min(1),
  in: z.enum(['path', 'query', 'header']),
  type: PrimitiveType,
  required: z.boolean().default(false), // path params are always required on export
  description: z.string().optional(),
});

export const ResponseSpec = z.object({
  status: z.string().regex(/^([1-5]\d\d|[1-5]XX|default)$/, 'Use a status like 200, 4XX or default'),
  description: z.string().default(''),
  body: FieldType.optional(),
});

export const RequestBody = z.object({
  contentType: z.string().default('application/json'),
  type: FieldType,
  required: z.boolean().default(true),
});

export const EndpointSpec = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  operationId: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).optional(),
  tags: z.array(z.string()).default([]),
  params: z.array(Param).default([]),
  requestBody: RequestBody.optional(),
  responses: z.array(ResponseSpec).min(1, 'Add at least one response').default([{ status: '200', description: '' }]),
  deprecated: z.boolean().default(false),
});

/* ============================================================
 * Project-level API settings
 * ============================================================ */

export const ApiSettings = z.object({
  title: z.string().default('Untitled API'),
  version: z.string().default('0.1.0'),
  description: z.string().optional(),
  servers: z
    .array(z.object({ url: z.string(), description: z.string().optional() }))
    .default([]),
  auth: z.enum(['none', 'bearer', 'apiKey']).default('bearer'),
  apiKeyHeader: z.string().default('X-API-Key'),
});

/* ============================================================
 * Types
 * ============================================================ */

export type PrimitiveType = z.infer<typeof PrimitiveType>;
export type FieldType = z.infer<typeof FieldType>;
export type Field = z.infer<typeof Field>;
export type ApiModel = z.infer<typeof ApiModel>;
export type Param = z.infer<typeof Param>;
export type EndpointSpec = z.infer<typeof EndpointSpec>;
export type ApiSettings = z.infer<typeof ApiSettings>;

/* ============================================================
 * Helpers
 * ============================================================ */

/** The model a field type points at, if any */
export const modelRefOf = (t: FieldType): string | undefined =>
  t.kind === 'ref' ? t.modelId : t.kind === 'array' && t.items.kind === 'ref' ? t.items.modelId : undefined;

const words = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
export const toPascal = (s: string) => words(s).map(cap).join('');
export const toCamel = (s: string) => {
  const p = toPascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
};

/** Postgres column type → OpenAPI primitive */
export const sqlToPrimitive = (sqlType: string): PrimitiveType => {
  const t = sqlType.trim().toLowerCase();
  if (t.startsWith('uuid')) return { kind: 'primitive', type: 'string', format: 'uuid' };
  if (/^(bigint|int8|bigserial)\b/.test(t)) return { kind: 'primitive', type: 'integer', format: 'int64' };
  if (/^(integer|int|int2|int4|smallint|serial|smallserial)\b/.test(t))
    return { kind: 'primitive', type: 'integer', format: 'int32' };
  if (/^(numeric|decimal|real|double|float)/.test(t)) return { kind: 'primitive', type: 'number' };
  if (/^bool/.test(t)) return { kind: 'primitive', type: 'boolean' };
  if (/^timestamp/.test(t)) return { kind: 'primitive', type: 'string', format: 'date-time' };
  if (/^date\b/.test(t)) return { kind: 'primitive', type: 'string', format: 'date' };
  return { kind: 'primitive', type: 'string' };
};

/** GET /orders/{orderId} → getOrdersByOrderId */
export const defaultOperationId = (method: string, path: string) =>
  method.toLowerCase() +
  path
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      const param = seg.match(/^\{(.+)\}$/);
      return toPascal(param ? `by ${param[1]}` : seg);
    })
    .join('');

/** OpenAPI treats paths that differ only in parameter names as the same: /a/{id} ≡ /a/{key} */
export const pathShape = (path: string) => path.replace(/\{[^}]+\}/g, '{}');

/** Names of the `{params}` in an OpenAPI path, in order */
export const pathParamNames = (path: string) => [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);

const newPathParam = (name: string): Param => ({
  id: crypto.randomUUID(),
  name,
  in: 'path',
  type: { kind: 'primitive', type: 'string' },
  required: true,
});

/**
 * Makes the declared path params match `{...}` in the path: existing ones keep their settings,
 * new ones come from `create` (required strings by default), stale ones are dropped.
 * Query and header params are kept. Generic so forms can sync their own param drafts.
 */
export function syncPathParams<P extends { name: string; in: string }>(
  path: string,
  params: readonly P[],
  create: (name: string) => P,
): P[];
export function syncPathParams(path: string, params: readonly Param[]): Param[];
export function syncPathParams(
  path: string,
  params: readonly { name: string; in: string }[],
  create: (name: string) => { name: string; in: string } = newPathParam,
) {
  const byName = new Map(params.filter((p) => p.in === 'path').map((p) => [p.name, p]));
  const pathParams = [...new Set(pathParamNames(path))].map((name) => byName.get(name) ?? create(name));
  return [...pathParams, ...params.filter((p) => p.in !== 'path')];
}

/** "Generate model from table": snake_case columns become camelCase fields */
export const modelFromTable = (table: TableNode, name?: string): ApiModel => ({
  id: crypto.randomUUID(),
  name: name ?? (toPascal(table.label) || 'Model'),
  fields: table.data.columns.map((c) => ({
    id: crypto.randomUUID(),
    name: toCamel(c.name) || c.name,
    type: sqlToPrimitive(c.type),
    required: true,
    nullable: c.nullable && !c.primaryKey,
    description: c.note,
  })),
  sourceTableId: table.id,
});
