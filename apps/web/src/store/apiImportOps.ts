import {
  CanvasDoc,
  CanvasNode,
  defaultOperationId,
  estimateNodeSize,
  pathShape,
  type ApiModel,
  type EndpointSpec,
  type FieldType,
  type ImportedApi,
  type ImportedEndpoint,
  type ImportWarning,
} from '@flowcanvas/shared';
import { absolutePosition, GROUP_PAD, groupIntoFrame } from './layoutOps';
import { newId, type Position } from './nodeFactory';

/*
 * Merges a parsed OpenAPI document (docs/openapi-import-plan.md §4) into the canvas. Models match by
 * name and endpoints by route (`METHOD` + path shape). A match is updated in place and keeps its id,
 * field and param ids, position, frame and every edge and flow step; new items are added. Nothing
 * is deleted: what the canvas has and the spec doesn't is only reported. Unchanged items stay as
 * they are, so re-importing the same file leaves the doc untouched.
 */

type EndpointNode = Extract<CanvasNode, { type: 'endpoint' }>;

export type ApiImportOptions = {
  /** Replace the API's title, version, description, servers and auth with the spec's */
  applySettings: boolean;
};

type Outcome = { added: string[]; updated: string[]; unchanged: string[] };

export type ApiImportResult = {
  /** The doc after the import; the same object when nothing changed */
  doc: CanvasDoc;
  /** Model ids */
  models: Outcome;
  /** Endpoint node ids */
  endpoints: Outcome;
  /** On the canvas but not in the spec (left alone): model ids and endpoint node ids */
  missing: { models: string[]; endpoints: string[] };
  settingsChanged: boolean;
  warnings: ImportWarning[];
  /** Canvas rules the result breaks ("nodes.3.data.spec.operationId: Duplicate operationId x"); empty when valid */
  issues: string[];
};

/** The spec's settings are taken by default when the canvas has no endpoints yet (plan §8.2) */
export const defaultApplySettings = (doc: CanvasDoc) => !doc.nodes.some((n) => n.type === 'endpoint');

const routeOf = (method: string, path: string) => `${method} ${pathShape(path)}`;
/** JSON with sorted keys and without undefined values, so equal content compares equal whatever the key order */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Field types with model refs pointing at canvas model ids instead of imported model names */
function remapType(type: FieldType, ids: ReadonlyMap<string, string>): FieldType {
  switch (type.kind) {
    case 'primitive':
      return type;
    case 'ref':
      return { kind: 'ref', modelId: ids.get(type.modelId) ?? type.modelId };
    case 'array':
      return { kind: 'array', items: remapType(type.items, ids) as typeof type.items };
  }
}

function mergeModel(imported: ApiModel, existing: ApiModel | undefined, ids: ReadonlyMap<string, string>): ApiModel {
  const fieldId = (name: string) =>
    (existing?.fields.find((f) => f.name === name) ?? existing?.fields.find((f) => f.name.toLowerCase() === name.toLowerCase()))?.id ?? newId();
  return {
    ...imported,
    id: ids.get(imported.name)!,
    fields: imported.fields.map((f) => ({ ...f, id: fieldId(f.name), type: remapType(f.type, ids) })),
    ...(existing?.sourceTableId && { sourceTableId: existing.sourceTableId }),
  };
}

function mergeSpec(imported: EndpointSpec, existing: EndpointSpec | undefined, ids: ReadonlyMap<string, string>): EndpointSpec {
  const paramId = (p: EndpointSpec['params'][number]) => existing?.params.find((e) => e.in === p.in && e.name === p.name)?.id ?? newId();
  return {
    ...imported,
    params: imported.params.map((p) => ({ ...p, id: paramId(p) })),
    ...(imported.requestBody && { requestBody: { ...imported.requestBody, type: remapType(imported.requestBody.type, ids) } }),
    responses: imported.responses.map((r) => (r.body ? { ...r, body: remapType(r.body, ids) } : r)),
  };
}

/** The doc with the spec's models and endpoints merged in (new endpoints at 0,0; `importApi` lays them out) */
export function buildApiImport(doc: CanvasDoc, api: ImportedApi, options: ApiImportOptions): ApiImportResult {
  const warnings = [...api.warnings];

  // Models: by name, case-insensitively
  const existingModels = new Map(doc.models.map((m) => [m.name.toLowerCase(), m]));
  const ids = new Map(api.models.map((m) => [m.name, existingModels.get(m.name.toLowerCase())?.id ?? newId()]));
  const models: Outcome = { added: [], updated: [], unchanged: [] };
  const mergedModels = new Map<string, ApiModel>();
  for (const imported of api.models) {
    const existing = existingModels.get(imported.name.toLowerCase());
    const merged = mergeModel(imported, existing, ids);
    if (!existing) models.added.push(merged.id);
    else if (same(existing, merged)) models.unchanged.push(merged.id);
    else models.updated.push(merged.id);
    mergedModels.set(merged.id, existing && same(existing, merged) ? existing : merged);
  }
  const nextModels = [
    ...doc.models.map((m) => mergedModels.get(m.id) ?? m),
    ...models.added.map((id) => mergedModels.get(id)!),
  ];

  // Endpoints: by route; operationIds already used by endpoints the spec doesn't touch are dropped
  const existingEndpoints = new Map(
    doc.nodes.filter((n): n is EndpointNode => n.type === 'endpoint').map((n) => [routeOf(n.data.method, n.data.path), n]),
  );
  const matched = new Set(api.endpoints.map((e) => existingEndpoints.get(routeOf(e.method, e.path))?.id).filter(Boolean));
  const takenIds = new Set(
    [...existingEndpoints.values()]
      .filter((n) => !matched.has(n.id))
      .map((n) => n.data.spec.operationId ?? defaultOperationId(n.data.method, n.data.path)),
  );
  const endpoints: Outcome = { added: [], updated: [], unchanged: [] };
  const replaced = new Map<string, CanvasNode>();
  const added: EndpointNode[] = [];
  for (const imported of api.endpoints) {
    const where = `${imported.method} ${imported.path}`;
    let spec = imported.spec;
    const operationId = spec.operationId ?? defaultOperationId(imported.method, imported.path);
    if (takenIds.has(operationId)) {
      warnings.push({
        kind: 'operation-id',
        where,
        message: `operationId ${operationId} is used by another endpoint on the canvas; dropped`,
        text: `${where}: operationId ${operationId} is used by another endpoint on the canvas; dropped`,
      });
      spec = { ...spec, operationId: undefined };
    }
    const existing = existingEndpoints.get(routeOf(imported.method, imported.path));
    const data: EndpointNode['data'] = {
      method: imported.method,
      path: imported.path,
      auth: imported.auth,
      spec: mergeSpec(spec, existing?.data.spec, ids),
    };
    if (!existing) {
      const node = endpointNode(imported, data);
      added.push(node);
      endpoints.added.push(node.id);
    } else if (same(existing.data, CanvasNode.parse({ ...existing, data }).data)) {
      endpoints.unchanged.push(existing.id);
    } else {
      replaced.set(existing.id, { ...existing, data });
      endpoints.updated.push(existing.id);
    }
  }

  const settings = options.applySettings ? { ...doc.api, ...api.settings } : doc.api;
  const settingsChanged = !same(settings, doc.api);

  const importedNames = new Set(api.models.map((m) => m.name.toLowerCase()));
  const importedRoutes = new Set(api.endpoints.map((e) => routeOf(e.method, e.path)));
  const missing = {
    models: doc.models.filter((m) => !importedNames.has(m.name.toLowerCase())).map((m) => m.id),
    endpoints: [...existingEndpoints].filter(([route]) => !importedRoutes.has(route)).map(([, n]) => n.id),
  };

  const changed = models.added.length + models.updated.length + endpoints.added.length + endpoints.updated.length > 0 || settingsChanged;
  const next: CanvasDoc = { ...doc, api: settings, models: nextModels, nodes: [...doc.nodes.map((n) => replaced.get(n.id) ?? n), ...added] };
  if (!changed) return { doc, models, endpoints, missing, settingsChanged, warnings, issues: [] };
  const parsed = CanvasDoc.safeParse(next);
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  return { doc: parsed.success ? parsed.data : next, models, endpoints, missing, settingsChanged, warnings, issues };
}

const endpointNode = (imported: ImportedEndpoint, data: EndpointNode['data']): EndpointNode =>
  CanvasNode.parse({
    id: newId(),
    type: 'endpoint',
    label: imported.spec.summary ?? '',
    position: { x: 0, y: 0 },
    data,
  }) as EndpointNode;

/** Space between the existing content and the import, and between tag frames */
const GAP = 160;
const ROW_GAP = 24;
const COLUMN_GAP = 48;
/** Endpoints per column inside a tag frame, so big tags wrap into several columns */
const PER_COLUMN = 20;

/** Top-left for new content: right of what's on the canvas, top-aligned with it */
function originRightOf(doc: CanvasDoc): Position {
  const rects = doc.nodes.map((n) => ({ ...absolutePosition(doc, n), ...(n.size ?? estimateNodeSize(n)) }));
  if (rects.length === 0) return { x: 0, y: 0 };
  return { x: Math.max(...rects.map((r) => r.x + r.width)) + GAP, y: Math.min(...rects.map((r) => r.y)) };
}

/**
 * The whole import: merge, then place new endpoints right of the existing content, one frame per
 * first tag (untagged ones last, without a frame), sorted by path, wrapping after PER_COLUMN.
 */
export function importApi(doc: CanvasDoc, api: ImportedApi, options: ApiImportOptions): ApiImportResult {
  const result = buildApiImport(doc, api, options);
  if (result.endpoints.added.length === 0 || result.issues.length) return result;

  const added = new Set(result.endpoints.added);
  const newNodes = result.doc.nodes.filter((n): n is EndpointNode => added.has(n.id) && n.type === 'endpoint');
  const tags = new Map<string, EndpointNode[]>();
  for (const n of newNodes) {
    const tag = n.data.spec.tags[0] ?? '';
    tags.set(tag, [...(tags.get(tag) ?? []), n]);
  }
  const groups = [...tags].sort(([a], [b]) => Number(a === '') - Number(b === ''));

  const origin = originRightOf(doc);
  const positions = new Map<string, Position>();
  let x = origin.x + GROUP_PAD.side;
  for (const [, members] of groups) {
    const sorted = [...members].sort((a, b) => a.data.path.localeCompare(b.data.path) || a.data.method.localeCompare(b.data.method));
    for (let start = 0; start < sorted.length; start += PER_COLUMN) {
      const column = sorted.slice(start, start + PER_COLUMN);
      let y = origin.y + GROUP_PAD.top;
      for (const n of column) {
        positions.set(n.id, { x: Math.round(x), y: Math.round(y) });
        y += estimateNodeSize(n).height + ROW_GAP;
      }
      x += Math.max(...column.map((n) => estimateNodeSize(n).width)) + COLUMN_GAP;
    }
    x += GAP - COLUMN_GAP + 2 * GROUP_PAD.side;
  }

  let next: CanvasDoc = { ...result.doc, nodes: result.doc.nodes.map((n) => (positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n)) };
  for (const [tag, members] of groups) {
    if (tag) next = groupIntoFrame(next, members.map((m) => m.id), estimateNodeSize, tag).doc;
  }
  return { ...result, doc: CanvasDoc.parse(next) };
}
