import { parse as parseYaml } from 'yaml';
import {
  defaultOperationId,
  pathShape,
  syncPathParams,
  toCamel,
  toPascal,
  type ApiModel,
  type ApiSettings,
  type EndpointSpec,
  type Field,
  type FieldType,
  type Param,
  type PrimitiveType,
} from './api';
import type { HttpMethod } from './canvas';

/* ============================================================
 * OpenAPI import (docs/openapi-import-plan.md): an OpenAPI 3.0 / 3.1 document (JSON or YAML) as
 * models, endpoints and API settings. Pure and lenient like the SQL/DBML parsers: what can't be
 * represented is approximated or skipped with a warning; only a document that can't be read at
 * all fails. The result is neutral (no positions, model refs by model name); the web app merges it.
 * ============================================================ */

export type ImportedEndpoint = {
  method: HttpMethod;
  path: string;
  auth: 'public' | 'user' | 'admin';
  spec: EndpointSpec;
};

/** What a warning is about, for grouping (e.g. the import preview folds each kind) */
export type ImportWarningKind =
  | 'skipped'
  | 'as-string'
  | 'union'
  | 'format'
  | 'parameter'
  | 'operation-id'
  | 'filled-in'
  | 'ref'
  | 'security'
  | 'document';

/** Group titles, in the order groups are listed */
export const IMPORT_WARNING_KINDS: Record<ImportWarningKind, string> = {
  skipped: 'Skipped',
  'as-string': 'Imported as a string (maps, nested arrays, free-form objects)',
  union: 'Several possible types (the first one is used)',
  format: 'Formats the canvas has no equivalent for (imported without a format)',
  parameter: 'Parameters simplified',
  'operation-id': 'operationIds renamed or dropped',
  'filled-in': 'Filled in',
  ref: 'References that could not be followed',
  security: 'Security',
  document: 'Document',
};

export type ImportWarning = {
  kind: ImportWarningKind;
  /** Where it happened: "GET /pets", "Schema Pet.labels", "Document" */
  where: string;
  message: string;
  /** `where: message`, for showing it on its own */
  text: string;
};

export type ImportWarningGroup = { kind: ImportWarningKind; title: string; warnings: ImportWarning[] };

/** Warnings grouped by kind, groups in `IMPORT_WARNING_KINDS` order, warnings in document order */
export function groupImportWarnings(warnings: readonly ImportWarning[]): ImportWarningGroup[] {
  return (Object.keys(IMPORT_WARNING_KINDS) as ImportWarningKind[]).flatMap((kind) => {
    const items = warnings.filter((w) => w.kind === kind);
    return items.length ? [{ kind, title: IMPORT_WARNING_KINDS[kind], warnings: items }] : [];
  });
}

export type ImportedApi = {
  version: '3.0' | '3.1';
  settings: ApiSettings;
  /** Model ids are the model names, and `ref` field types point at them */
  models: ApiModel[];
  endpoints: ImportedEndpoint[];
  warnings: ImportWarning[];
};

export type OpenApiImportResult = { ok: true; api: ImportedApi } | { ok: false; error: string };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const asObject = (v: unknown): Json => (isObject(v) ? v : {});
const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const METHODS: Record<string, HttpMethod> = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE' };
const UNSUPPORTED_METHODS = ['head', 'options', 'trace'];

const FORMATS: Record<PrimitiveType['type'], readonly string[]> = {
  string: ['uuid', 'email', 'uri', 'date', 'date-time'],
  integer: ['int32', 'int64'],
  number: ['float', 'double'],
  boolean: [],
};

const MODEL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const STATUS = /^([1-5]\d\d|[1-5]XX|default)$/;

/** A model name from any text: kept when valid, else PascalCased (`order-item` → `OrderItem`) */
function modelName(text: string): string {
  if (MODEL_NAME.test(text)) return text;
  const name = toPascal(text);
  return /^[A-Za-z]/.test(name) ? name : `Model${name}`;
}

/** An example as the text a field stores: strings as written, other values as JSON */
const exampleText = (v: unknown): string | undefined =>
  v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v);

/** The JSON-ish media type of a content map: application/json, else `*+json`, else the first */
function pickContent(content: unknown): [string, Json] | undefined {
  const entries = Object.entries(asObject(content));
  const found =
    entries.find(([type]) => type === 'application/json') ??
    entries.find(([type]) => /[/+]json\b/i.test(type)) ??
    entries[0];
  return found && [found[0], asObject(found[1])];
}

class Importer {
  readonly warnings: ImportWarning[] = [];
  /** Component models in document order, then models hoisted from inline objects */
  private readonly componentList: ApiModel[] = [];
  private readonly hoistedList: ApiModel[] = [];
  /** Component schema key → model name, for object-like components */
  private readonly componentModels = new Map<string, string>();
  private readonly usedNames = new Set<string>();
  /** Inline schemas already hoisted into a model (one schema object, one model) */
  private readonly hoisted = new Map<object, string>();
  /** Components being mapped, to stop `$ref` cycles through non-model schemas */
  private readonly resolving = new Set<string>();
  private readonly warnedFormats = new Set<string>();

  constructor(private readonly root: Json) {}

  warn(kind: ImportWarningKind, where: string, message: string) {
    const text = `${where}: ${message}`;
    if (!this.warnings.some((w) => w.text === text)) this.warnings.push({ kind, where, message, text });
  }

  /* ---------- $ref ---------- */

  /** The target of a local `$ref` (`#/a/b~1c`); undefined (warned) for external or broken refs */
  private lookup(ref: string, where: string): unknown {
    if (!ref.startsWith('#/')) {
      this.warn('ref', where, `external $ref ${ref} skipped`);
      return undefined;
    }
    let node: unknown = this.root;
    for (const part of ref.slice(2).split('/')) {
      const key = decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~');
      node = isObject(node) ? node[key] : undefined;
    }
    if (node === undefined) this.warn('ref', where, `$ref ${ref} not found`);
    return node;
  }

  /** Follows `$ref`s of non-schema objects (parameters, request bodies, responses) */
  deref(value: unknown, where: string): Json | undefined {
    const seen = new Set<string>();
    let node = value;
    while (isObject(node) && typeof node.$ref === 'string') {
      if (seen.has(node.$ref)) {
        this.warn('ref', where, `$ref cycle at ${node.$ref}`);
        return undefined;
      }
      seen.add(node.$ref);
      node = this.lookup(node.$ref, where);
    }
    return isObject(node) ? node : undefined;
  }

  /* ---------- models ---------- */

  private reserve(base: string): string {
    let name = modelName(base);
    for (let i = 2; [...this.usedNames].some((n) => n.toLowerCase() === name.toLowerCase()); i++) name = `${modelName(base)}${i}`;
    this.usedNames.add(name);
    return name;
  }

  /** Objects with properties, `allOf` compositions and plain `type: object` become models; maps don't */
  private isModelSchema(schema: Json): boolean {
    if (isObject(schema.properties) || Array.isArray(schema.allOf)) return true;
    return schema.type === 'object' && schema.additionalProperties === undefined;
  }

  /** Names every object-like component up front, so references resolve whatever the order */
  collectComponents() {
    for (const [key, value] of Object.entries(asObject(asObject(this.root.components).schemas))) {
      if (isObject(value) && this.isModelSchema(value)) this.componentModels.set(key, this.reserve(key));
    }
    for (const [key, value] of Object.entries(asObject(asObject(this.root.components).schemas))) {
      const name = this.componentModels.get(key);
      if (name && isObject(value)) this.componentList.push(this.buildModel(name, value, `Schema ${key}`));
    }
  }

  /** The properties of a schema with its `allOf` parts merged in (refs resolved) */
  private flatten(schema: Json, where: string, seen = new Set<object>()): { properties: [string, unknown][]; required: Set<string> } {
    const properties = new Map<string, unknown>();
    const required = new Set<string>();
    const visit = (s: Json) => {
      if (seen.has(s)) return;
      seen.add(s);
      for (const part of Array.isArray(s.allOf) ? s.allOf : []) {
        const resolved = isObject(part) && typeof part.$ref === 'string' ? this.lookup(part.$ref, where) : part;
        if (isObject(resolved)) visit(resolved);
      }
      for (const [name, prop] of Object.entries(asObject(s.properties))) properties.set(name, prop);
      for (const name of Array.isArray(s.required) ? s.required : []) if (typeof name === 'string') required.add(name);
      if (Array.isArray(s.oneOf) || Array.isArray(s.anyOf)) this.warn('union', where, 'oneOf/anyOf next to properties ignored');
    };
    visit(schema);
    return { properties: [...properties], required };
  }

  private buildModel(name: string, schema: Json, where: string): ApiModel {
    const { properties, required } = this.flatten(schema, where);
    const fields = properties.map(([fieldName, prop]): Field => {
      const p = asObject(prop);
      const { type, nullable } = this.fieldType(prop, `${name}${toPascal(fieldName)}`, `${where}.${fieldName}`);
      const description = asString(p.description)?.trim();
      const example = exampleText(p.example ?? (Array.isArray(p.examples) ? p.examples[0] : undefined));
      return {
        id: `${name}.${fieldName}`,
        name: fieldName,
        type,
        required: required.has(fieldName),
        nullable,
        ...(description && { description }),
        ...(example !== undefined && { example }),
      };
    });
    const description = asString(schema.description)?.trim();
    return { id: name, name, fields, ...(description && { description }) };
  }

  /** An inline object as a new model named after where it sits (one model per schema object) */
  private hoist(schema: Json, hint: string, where: string): FieldType {
    let name = this.hoisted.get(schema);
    if (!name) {
      name = this.reserve(hint);
      this.hoisted.set(schema, name);
      this.hoistedList.push(this.buildModel(name, schema, where));
    }
    return { kind: 'ref', modelId: name };
  }

  /* ---------- field types ---------- */

  private primitive(schema: Json, type: PrimitiveType['type'], where: string): PrimitiveType {
    const format = asString(schema.format);
    const known = format && FORMATS[type].includes(format);
    if (format && !known && !this.warnedFormats.has(`${type}:${format}`)) {
      this.warnedFormats.add(`${type}:${format}`);
      this.warn('format', where, `format ${format} is not supported for ${type}; imported without a format`);
    }
    const values = Array.isArray(schema.enum) ? schema.enum : schema.const !== undefined ? [schema.const] : undefined;
    const enumValues = values?.filter((v) => v !== null).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
    return {
      kind: 'primitive',
      type,
      ...(known && { format: format as PrimitiveType['format'] }),
      ...(enumValues?.length && { enum: enumValues }),
    };
  }

  /**
   * A schema as a field type plus whether it allows null. Inline objects are hoisted into models
   * named by `hint`; what the canvas can't hold becomes a string (warned).
   */
  fieldType(value: unknown, hint: string, where: string): { type: FieldType; nullable: boolean } {
    const fallback = (message: string) => {
      this.warn('as-string', where, `${message}; imported as a string`);
      return { type: { kind: 'primitive', type: 'string' } as FieldType, nullable: false };
    };
    if (!isObject(value)) return fallback('missing schema');
    const schema = value;

    if (typeof schema.$ref === 'string') {
      const match = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
      const key = match && decodeURIComponent(match[1]!).replaceAll('~1', '/').replaceAll('~0', '~');
      const model = key ? this.componentModels.get(key) : undefined;
      if (model) return { type: { kind: 'ref', modelId: model }, nullable: schema.nullable === true };
      // A non-object component (enum, alias) is inlined where it's used
      if (this.resolving.has(schema.$ref)) return fallback(`recursive $ref ${schema.$ref}`);
      const target = this.lookup(schema.$ref, where);
      if (target === undefined) return fallback(`unresolved $ref ${schema.$ref}`);
      this.resolving.add(schema.$ref);
      const result = this.fieldType(target, hint, where);
      this.resolving.delete(schema.$ref);
      return schema.nullable === true ? { ...result, nullable: true } : result;
    }

    let nullable = schema.nullable === true;
    // 3.1: `type: [T, "null"]`
    let type = schema.type;
    if (Array.isArray(type)) {
      nullable ||= type.includes('null');
      const types = type.filter((t) => t !== 'null');
      if (types.length > 1) this.warn('union', where, `several types (${types.join(', ')}); using ${types[0]}`);
      type = types[0];
    }
    if (Array.isArray(schema.enum) && schema.enum.includes(null)) nullable = true;

    // anyOf / oneOf: `[X, {type: null}]` is a nullable X; several real options take the first
    const union = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined;
    if (union && !isObject(schema.properties)) {
      const isNull = (o: unknown) => isObject(o) && (o.type === 'null' || (Array.isArray(o.enum) && o.enum.length === 1 && o.enum[0] === null));
      const options = union.filter((o) => !isNull(o));
      if (options.length < union.length) nullable = true;
      if (options.length === 0) return fallback('only null allowed');
      if (options.length > 1) this.warn('union', where, `oneOf/anyOf with ${options.length} options; using the first`);
      const result = this.fieldType(options[0], hint, where);
      return { type: result.type, nullable: nullable || result.nullable };
    }

    // allOf with one part is that part (a common way to add a description to a $ref)
    if (Array.isArray(schema.allOf) && schema.allOf.length === 1 && !isObject(schema.properties)) {
      const result = this.fieldType(schema.allOf[0], hint, where);
      return { type: result.type, nullable: nullable || result.nullable };
    }

    if (type === 'array' || (type === undefined && schema.items !== undefined)) {
      const items = this.fieldType(schema.items, `${hint}Item`, `${where}[]`);
      if (items.type.kind === 'array') return fallback('array of arrays');
      return { type: { kind: 'array', items: items.type }, nullable };
    }

    if (type === 'object' || type === undefined && (isObject(schema.properties) || Array.isArray(schema.allOf))) {
      if (!this.isModelSchema(schema)) return fallback(isObject(schema.additionalProperties) || schema.additionalProperties === true ? 'map (additionalProperties)' : 'free-form object');
      return { type: this.hoist(schema, hint, where), nullable };
    }

    if (type === 'string' || type === 'integer' || type === 'number' || type === 'boolean')
      return { type: this.primitive(schema, type, where), nullable };

    // No type: an enum of strings is a string enum, anything else is free-form
    if (type === undefined && Array.isArray(schema.enum)) return { type: this.primitive(schema, 'string', where), nullable };
    if (type === undefined && schema.const !== undefined) return { type: this.primitive(schema, 'string', where), nullable };
    return fallback(type === undefined ? 'schema without a type' : `type ${String(type)}`);
  }

  /** A parameter type: primitives only; arrays use their item type */
  private paramType(schema: unknown, where: string): PrimitiveType {
    const { type } = this.fieldType(schema, 'Param', where);
    if (type.kind === 'primitive') return type;
    if (type.kind === 'array' && type.items.kind === 'primitive') {
      this.warn('parameter', where, 'array parameter; imported as its item type');
      return type.items;
    }
    this.warn('parameter', where, 'object parameter; imported as a string');
    return { kind: 'primitive', type: 'string' };
  }

  /* ---------- paths ---------- */

  private params(pathItem: Json, op: Json, where: string): Param[] {
    const byKey = new Map<string, Param>();
    for (const raw of [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
      const p = this.deref(raw, where);
      const name = asString(p?.name);
      const location = asString(p?.in);
      if (!p || !name || !location) continue;
      if (location !== 'path' && location !== 'query' && location !== 'header') {
        this.warn('skipped', where, `${location} parameter ${name} skipped`);
        continue;
      }
      let schema = p.schema;
      if (schema === undefined && isObject(p.content)) {
        schema = pickContent(p.content)?.[1].schema;
        this.warn('parameter', where, `parameter ${name} uses content; imported from its schema`);
      }
      const description = asString(p.description)?.trim();
      // Operation-level parameters override path-level ones
      byKey.set(`${location}:${name}`, {
        id: `${location}:${name}`,
        name,
        in: location,
        type: this.paramType(schema, `${where} parameter ${name}`),
        required: location === 'path' || p.required === true,
        ...(description && { description }),
      });
    }
    return [...byKey.values()];
  }

  private body(op: Json, opName: string, where: string): EndpointSpec['requestBody'] {
    if (op.requestBody === undefined) return undefined;
    const rb = this.deref(op.requestBody, where);
    const content = rb && pickContent(rb.content);
    if (!content) {
      this.warn('skipped', where, 'request body without content skipped');
      return undefined;
    }
    const { type } = this.fieldType(content[1].schema ?? {}, `${opName}Body`, `${where} request body`);
    return { contentType: content[0], type, required: rb.required === true };
  }

  private responses(op: Json, opName: string, where: string): EndpointSpec['responses'] {
    const result: EndpointSpec['responses'] = [];
    for (const [rawStatus, raw] of Object.entries(asObject(op.responses))) {
      const status = rawStatus.toUpperCase() === 'DEFAULT' ? 'default' : rawStatus.toUpperCase();
      if (!STATUS.test(status)) {
        this.warn('skipped', where, `response ${rawStatus} skipped`);
        continue;
      }
      const r = this.deref(raw, where);
      if (!r) continue;
      const content = pickContent(r.content);
      const success = status.startsWith('2');
      const hint = `${opName}${success ? '' : status === 'default' ? 'Default' : status}Response`;
      const body = content?.[1].schema !== undefined ? this.fieldType(content[1].schema, hint, `${where} ${status} response`).type : undefined;
      result.push({ status, description: asString(r.description)?.trim() ?? '', ...(body && { body }) });
    }
    if (result.length === 0) {
      this.warn('filled-in', where, 'no responses; added 200');
      result.push({ status: '200', description: '' });
    }
    return result;
  }

  /** Each operation as an endpoint; route and operationId clashes keep the first */
  collectEndpoints(security: SecurityContext): ImportedEndpoint[] {
    const endpoints: ImportedEndpoint[] = [];
    const routes = new Set<string>();
    const operationIds = new Set<string>();
    for (const [path, rawItem] of Object.entries(asObject(this.root.paths))) {
      const pathItem = this.deref(rawItem, path);
      if (!pathItem) continue;
      if (!path.startsWith('/')) {
        this.warn('skipped', path, 'path must start with /; skipped');
        continue;
      }
      for (const method of UNSUPPORTED_METHODS) if (pathItem[method]) this.warn('skipped', `${method.toUpperCase()} ${path}`, 'method not supported; skipped');
      for (const [key, method] of Object.entries(METHODS)) {
        const op = asObject(pathItem[key]);
        if (!isObject(pathItem[key])) continue;
        const where = `${method} ${path}`;
        const route = `${method} ${pathShape(path)}`;
        if (routes.has(route)) {
          this.warn('skipped', where, 'same route as another operation (only parameter names differ); skipped');
          continue;
        }
        routes.add(route);

        // operationId: kept unless it is the generated default; invalid ones are camelCased
        const fallbackId = defaultOperationId(method, path);
        let operationId = asString(op.operationId);
        if (operationId && !MODEL_NAME.test(operationId)) {
          const fixed = toCamel(operationId);
          this.warn('operation-id', where, `operationId ${operationId} renamed to ${fixed}`);
          operationId = /^[A-Za-z]/.test(fixed) ? fixed : undefined;
        }
        if (operationId && operationIds.has(operationId)) {
          this.warn('operation-id', where, `duplicate operationId ${operationId} dropped`);
          operationId = undefined;
        }
        operationIds.add(operationId ?? fallbackId);
        const opName = toPascal(operationId ?? fallbackId);

        const declared = this.params(pathItem, op, where);
        const params = syncPathParams<Param>(path, declared, (name) => {
          this.warn('filled-in', where, `path parameter ${name} not declared; added as a string`);
          return { id: `path:${name}`, name, in: 'path', type: { kind: 'primitive', type: 'string' }, required: true };
        });
        for (const p of declared) if (p.in === 'path' && !params.includes(p)) this.warn('skipped', where, `path parameter ${p.name} is not in the path; skipped`);

        const summary = asString(op.summary)?.trim();
        const description = asString(op.description)?.trim();
        const tags = Array.isArray(op.tags) ? op.tags.filter((t): t is string => typeof t === 'string') : [];
        const requestBody = this.body(op, opName, where);
        endpoints.push({
          method,
          path,
          auth: security.authOf(op),
          spec: {
            ...(summary && { summary }),
            ...(description && { description }),
            ...(operationId && operationId !== fallbackId && { operationId }),
            tags,
            params,
            ...(requestBody && { requestBody }),
            responses: this.responses(op, opName, where),
            deprecated: op.deprecated === true,
          },
        });
      }
    }
    return endpoints;
  }

  get allModels() {
    return [...this.componentList, ...this.hoistedList];
  }
}

/* ---------- security ---------- */

type SecurityContext = { auth: ApiSettings['auth']; apiKeyHeader?: string; authOf(op: Json): ImportedEndpoint['auth'] };

/** The API's auth scheme and each operation's access, from `security` and `securitySchemes` */
function securityContext(root: Json, importer: Importer): SecurityContext {
  const schemes = asObject(asObject(root.components).securitySchemes);
  const requirementNames = (security: unknown) =>
    Array.isArray(security) ? security.flatMap((req) => (isObject(req) ? Object.keys(req) : [])) : [];

  const global = Array.isArray(root.security) ? root.security : undefined;
  // Without a global requirement, the first operation that has one names the scheme
  const operations = Object.values(asObject(root.paths)).flatMap((item) => Object.keys(METHODS).map((m) => asObject(asObject(item)[m])));
  const firstName = requirementNames(global)[0] ?? operations.flatMap((op) => requirementNames(op.security))[0];

  let auth: ApiSettings['auth'] = 'none';
  let apiKeyHeader: string | undefined;
  if (firstName) {
    const scheme = importer.deref(schemes[firstName], `Security scheme ${firstName}`) ?? {};
    if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer') auth = 'bearer';
    else if (scheme.type === 'apiKey' && scheme.in === 'header' && typeof scheme.name === 'string') {
      auth = 'apiKey';
      apiKeyHeader = scheme.name;
    } else {
      auth = 'bearer';
      importer.warn('security', `Security scheme ${firstName}`, `${String(scheme.type ?? 'unknown')} is not supported; imported as bearer`);
    }
  }

  return {
    auth,
    apiKeyHeader,
    authOf(op) {
      const role = op['x-required-role'] === 'admin' ? 'admin' : 'user';
      if (auth === 'none') return role;
      const security = Array.isArray(op.security) ? op.security : global;
      // No requirement, or an empty one (`{}`), means anyone may call it
      if (!security || security.length === 0 || security.some((req) => isObject(req) && Object.keys(req).length === 0)) return 'public';
      return role;
    },
  };
}

/** Reads JSON or YAML; YAML is a superset of JSON, but JSON.parse gives better errors for `{...}` */
function load(text: string): unknown {
  const trimmed = text.trim();
  return trimmed.startsWith('{') ? JSON.parse(trimmed) : parseYaml(trimmed);
}

/** An OpenAPI 3.0 or 3.1 document (JSON or YAML) as models, endpoints and API settings */
export function parseOpenApi(text: string): OpenApiImportResult {
  let root: unknown;
  try {
    root = load(text);
  } catch (error) {
    return { ok: false, error: `Not valid JSON or YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` };
  }
  if (!isObject(root)) return { ok: false, error: 'Not an OpenAPI document' };
  if (typeof root.swagger === 'string')
    return { ok: false, error: 'Swagger 2.0 is not supported; convert it to OpenAPI 3 first (e.g. with swagger2openapi)' };
  const openapi = String(root.openapi ?? '');
  if (!/^3\.\d/.test(openapi)) return { ok: false, error: 'Not an OpenAPI 3 document (no "openapi: 3.x" field)' };

  const importer = new Importer(root);
  if (!/^3\.[01]\b/.test(openapi)) importer.warn('document', 'Document', `OpenAPI ${openapi} read as 3.1`);
  importer.collectComponents();
  const security = securityContext(root, importer);
  const endpoints = importer.collectEndpoints(security);

  const info = asObject(root.info);
  const description = asString(info.description)?.trim();
  const servers = (Array.isArray(root.servers) ? root.servers : []).flatMap((s) => {
    const url = asString(asObject(s).url);
    const desc = asString(asObject(s).description)?.trim();
    return url ? [{ url, ...(desc && { description: desc }) }] : [];
  });
  for (const key of ['webhooks', 'x-webhooks']) if (root[key]) importer.warn('skipped', 'Document', `${key} skipped`);

  return {
    ok: true,
    api: {
      version: openapi.startsWith('3.0') ? '3.0' : '3.1',
      settings: {
        title: asString(info.title)?.trim() || 'Untitled API',
        version: asString(info.version)?.trim() || '0.1.0',
        ...(description && { description }),
        servers,
        auth: security.auth,
        apiKeyHeader: security.apiKeyHeader ?? 'X-API-Key',
      },
      models: importer.allModels,
      endpoints,
      warnings: importer.warnings,
    },
  };
}
