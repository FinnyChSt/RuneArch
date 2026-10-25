import { stringify } from 'yaml';
import type { CanvasDoc } from './canvas';
import { defaultOperationId, type ApiModel, type Field, type FieldType, type Param } from './api';
import { applyScope, referencedModels, scopeToFeature, type ExportScope } from './feature-scope';

type Json = Record<string, unknown>;

export class OpenApiExportError extends Error {}

/** Standard description for a status (used when a response has none), e.g. 201 → "Created" */
export const statusText = (status: string) =>
  STATUS_TEXT[status] ?? (status === 'default' ? 'Default response' : /^[1-5]XX$/.test(status) ? `${status[0]}xx response` : 'Response');

/** Drops undefined values only; empty arrays like `security: []` are meaningful */
const compact = (o: Json): Json =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const STATUS_TEXT: Record<string, string> = {
  '200': 'OK', '201': 'Created', '202': 'Accepted', '204': 'No Content',
  '400': 'Bad Request', '401': 'Unauthorized', '403': 'Forbidden', '404': 'Not Found',
  '409': 'Conflict', '422': 'Unprocessable Entity', '500': 'Internal Server Error',
};

export function toOpenApi(doc: CanvasDoc): Json {
  const { api } = doc;
  const models = new Map(doc.models.map((m) => [m.id, m]));

  const ref = (modelId: string): Json => {
    const m = models.get(modelId);
    if (!m) throw new OpenApiExportError(`Unknown model ${modelId}`);
    return { $ref: `#/components/schemas/${m.name}` };
  };

  const typeSchema = (t: FieldType): Json => {
    switch (t.kind) {
      case 'primitive':
        return compact({ type: t.type, format: t.format, enum: t.enum?.length ? t.enum : undefined });
      case 'ref':
        return ref(t.modelId);
      case 'array':
        return { type: 'array', items: typeSchema(t.items) };
    }
  };

  const exampleValue = (f: Field): unknown => {
    if (f.example === undefined) return undefined;
    if (f.type.kind === 'primitive' && f.type.type === 'string') return f.example;
    try {
      return JSON.parse(f.example); // "42" → 42, "true" → true, '{"a":1}' → object
    } catch {
      return f.example;
    }
  };

  const fieldSchema = (f: Field): Json => {
    let s = typeSchema(f.type);
    if (f.nullable) {
      s = f.type.kind === 'primitive' ? { ...s, type: [f.type.type, 'null'] } : { anyOf: [s, { type: 'null' }] };
    }
    const example = exampleValue(f);
    return compact({ ...s, description: f.description, examples: example === undefined ? undefined : [example] });
  };

  const modelSchema = (m: ApiModel): Json => {
    const required = m.fields.filter((f) => f.required).map((f) => f.name);
    return compact({
      type: 'object',
      description: m.description,
      properties: Object.fromEntries(m.fields.map((f) => [f.name, fieldSchema(f)])),
      required: required.length ? required : undefined,
    });
  };

  const paramSchema = (p: Param): Json =>
    compact({
      name: p.name,
      in: p.in,
      required: p.in === 'path' ? true : p.required,
      description: p.description,
      schema: typeSchema(p.type),
    });

  const paths: Record<string, Json> = {};
  const tags = new Set<string>();

  for (const node of doc.nodes) {
    if (node.type !== 'endpoint') continue;
    const { method, path, auth, spec } = node.data;
    spec.tags.forEach((t) => tags.add(t));

    const item = (paths[path] ??= {});
    item[method.toLowerCase()] = compact({
      operationId: spec.operationId ?? defaultOperationId(method, path),
      summary: spec.summary ?? (node.label || undefined),
      description: spec.description ?? node.notes,
      tags: spec.tags.length ? spec.tags : undefined,
      deprecated: spec.deprecated || undefined,
      parameters: spec.params.length ? spec.params.map(paramSchema) : undefined,
      requestBody: spec.requestBody && {
        required: spec.requestBody.required,
        content: { [spec.requestBody.contentType]: { schema: typeSchema(spec.requestBody.type) } },
      },
      responses: Object.fromEntries(
        spec.responses.map((r) => [
          r.status,
          compact({
            description: r.description || statusText(r.status),
            content: r.body && { 'application/json': { schema: typeSchema(r.body) } },
          }),
        ]),
      ),
      // Public endpoints opt out of the global security requirement
      security: auth === 'public' && api.auth !== 'none' ? [] : undefined,
      // Roles aren't an OpenAPI concept; keep them as a vendor extension
      'x-required-role': auth === 'admin' ? 'admin' : undefined,
    });
  }

  const securitySchemes =
    api.auth === 'bearer'
      ? { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }
      : api.auth === 'apiKey'
        ? { apiKeyAuth: { type: 'apiKey', in: 'header', name: api.apiKeyHeader } }
        : undefined;
  const schemeName = securitySchemes && Object.keys(securitySchemes)[0];

  return compact({
    openapi: '3.1.0',
    info: compact({ title: api.title, version: api.version, description: api.description }),
    servers: api.servers.length ? api.servers : undefined,
    tags: tags.size ? [...tags].sort().map((name) => ({ name })) : undefined,
    security: schemeName ? [{ [schemeName]: [] }] : undefined,
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: compact({
      schemas: doc.models.length
        ? Object.fromEntries(doc.models.map((m) => [m.name, modelSchema(m)]))
        : undefined,
      securitySchemes,
    }),
  });
}

export const toOpenApiJson = (doc: CanvasDoc) => JSON.stringify(toOpenApi(doc), null, 2);
export const toOpenApiYaml = (doc: CanvasDoc) => stringify(toOpenApi(doc));

/** How a feature marks operations and schemas */
const FEATURE_STATUS = { uses: 'existing', added: 'new', changed: 'changed', removed: 'removed' } as const;

export type FeatureOpenApiOptions = {
  /** Only the endpoints the feature adds, changes or removes (and the models they need) */
  onlyChanges?: boolean;
};

/**
 * The OpenAPI spec of one feature: its endpoints (and the models they need), each operation and
 * schema marked `x-feature-status: existing | new | changed | removed`, removed operations
 * `deprecated`. Null for an unknown feature.
 */
export function toFeatureOpenApi(doc: CanvasDoc, featureId: string, { onlyChanges = false }: FeatureOpenApiOptions = {}): Json | null {
  const scoped = scopeToFeature(doc, featureId);
  if (!scoped) return null;
  const roles = scoped.roles!;
  const role = (kind: 'node' | 'model', id: string) => roles.get(`${kind}:${id}`) ?? 'uses';
  let scopedDoc = scoped.doc;
  if (onlyChanges) {
    const nodes = scopedDoc.nodes.filter((n) => n.type !== 'endpoint' || role('node', n.id) !== 'uses');
    const own = scopedDoc.models.filter((m) => role('model', m.id) !== 'uses').map((m) => m.id);
    const needed = referencedModels(nodes, scopedDoc.models, own);
    scopedDoc = { ...scopedDoc, nodes, models: scopedDoc.models.filter((m) => needed.has(m.id)) };
  }
  const spec = toOpenApi(scopedDoc);
  const paths = (spec.paths ?? {}) as Record<string, Record<string, Json>>;
  for (const n of scopedDoc.nodes) {
    if (n.type !== 'endpoint') continue;
    const op = paths[n.data.path]?.[n.data.method.toLowerCase()];
    if (!op) continue;
    const r = role('node', n.id);
    op['x-feature-status'] = FEATURE_STATUS[r];
    if (r === 'removed') op.deprecated = true;
  }
  const schemas = ((spec.components as Json | undefined)?.schemas ?? {}) as Record<string, Json>;
  for (const m of scopedDoc.models) if (schemas[m.name]) schemas[m.name]!['x-feature-status'] = FEATURE_STATUS[role('model', m.id)];
  return { ...spec, info: { ...(spec.info as Json), 'x-feature': scoped.featureName } };
}

/** The spec of an export scope: the whole project (optionally without unshipped additions) or one feature */
export function toScopedOpenApi(doc: CanvasDoc, scope: ExportScope = {}, options: FeatureOpenApiOptions = {}): Json | null {
  if (scope.featureId) return toFeatureOpenApi(doc, scope.featureId, options);
  return toOpenApi(applyScope(doc, scope)!.doc);
}

export const specToYaml = (spec: Json) => stringify(spec);
