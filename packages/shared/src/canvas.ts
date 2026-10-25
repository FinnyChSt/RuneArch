import { z } from 'zod';
import { DatabaseSettings } from './database';
import {
  ApiModel,
  ApiSettings,
  defaultOperationId,
  EndpointSpec,
  modelRefOf,
  pathParamNames,
  pathShape,
  type FieldType,
} from './api';
import { elementIdOf, isInteractive, Wireframe } from './wireframe';

/* ============================================================
 * Primitives
 * ============================================================ */

export const Id = z.string().min(1);
export const Position = z.object({ x: z.number(), y: z.number() });
export const Size = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

const nodeBase = {
  id: Id,
  position: Position,
  size: Size.optional(),
  /** Id of an enclosing frame node (swimlane / group), if any; `position` is then relative to the frame */
  parentId: Id.optional(),
  label: z.string().default(''),
  color: z.string().optional(),
  notes: z.string().optional(),
};

/* ============================================================
 * Frontend nodes
 * ============================================================ */

export const ScreenNode = z.object({
  ...nodeBase,
  type: z.literal('screen'),
  data: z.object({
    route: z.string().optional(),
    state: z.array(z.string()).default([]),
    /** Low-fidelity layout of the screen, shown on its card */
    wireframe: Wireframe.optional(),
  }),
});

export const ComponentNode = z.object({
  ...nodeBase,
  type: z.literal('component'),
  data: z.object({
    props: z.array(z.string()).default([]),
    /** Reusable layout, placed on screens as `instance` elements */
    wireframe: Wireframe.optional(),
  }),
});

export const StoreNode = z.object({
  ...nodeBase,
  type: z.literal('store'),
  data: z.object({ keys: z.array(z.string()).default([]) }),
});

/* ============================================================
 * Backend nodes
 * ============================================================ */

export const HttpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const EndpointNode = z.object({
  ...nodeBase,
  type: z.literal('endpoint'),
  data: z.object({
    method: HttpMethod,
    /** OpenAPI path syntax: /orders/{orderId} */
    path: z.string().startsWith('/', 'Path must start with /'),
    auth: z.enum(['public', 'user', 'admin']).default('user'),
    spec: EndpointSpec.default({
      tags: [],
      params: [],
      responses: [{ status: '200', description: '' }],
      deprecated: false,
    }),
  }),
});

export const ServiceNode = z.object({
  ...nodeBase,
  type: z.literal('service'),
  data: z.object({ methods: z.array(z.string()).default([]) }),
});

export const JobNode = z.object({
  ...nodeBase,
  type: z.literal('job'),
  data: z.object({
    trigger: z.enum(['cron', 'queue', 'event']),
    schedule: z.string().optional(), // e.g. cron expression
  }),
});

export const ExternalNode = z.object({
  ...nodeBase,
  type: z.literal('external'),
  data: z.object({ baseUrl: z.string().url().optional() }),
});

/* ============================================================
 * Database nodes
 * ============================================================ */

export const Column = z.object({
  id: Id, // stable id so renames don't break FK edges
  name: z.string().trim().min(1, 'Column name is required'),
  type: z.string().trim().min(1, 'Column type is required'), // 'uuid', 'varchar(255)', 'timestamptz', ...
  primaryKey: z.boolean().default(false),
  nullable: z.boolean().default(true),
  unique: z.boolean().default(false),
  default: z.string().optional(),
  note: z.string().optional(),
});

export const TableIndex = z.object({
  id: Id,
  name: z.string().optional(),
  columnIds: z.array(Id).min(1, 'Pick at least one column'),
  unique: z.boolean().default(false),
});

export const TableNode = z.object({
  ...nodeBase,
  type: z.literal('table'),
  data: z.object({
    schema: z.string().default('public'),
    columns: z.array(Column).default([]),
    indexes: z.array(TableIndex).default([]),
  }),
});

/* ============================================================
 * Layout & sketch nodes
 * ============================================================ */

export const FrameNode = z.object({
  ...nodeBase,
  type: z.literal('frame'),
  data: z.object({
    lane: z.enum(['frontend', 'backend', 'database', 'none']).default('none'),
  }),
});

export const SketchNode = z.object({
  ...nodeBase,
  type: z.literal('sketch'),
  data: z.object({
    shape: z.enum(['rect', 'ellipse', 'text', 'sticky', 'freehand']),
    text: z.string().optional(),
    /** Freehand only: [x, y, pressure] relative to node position */
    points: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(),
  }),
});

export const CanvasNode = z.discriminatedUnion('type', [
  ScreenNode,
  ComponentNode,
  StoreNode,
  EndpointNode,
  ServiceNode,
  JobNode,
  ExternalNode,
  TableNode,
  FrameNode,
  SketchNode,
]);

/* ============================================================
 * Edges
 * ============================================================ */

const edgeBase = {
  id: Id,
  source: Id,
  target: Id,
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(), // e.g. "POST /orders"
};

/** What a connection does to a table's rows */
export const CrudOp = z.enum(['create', 'read', 'update', 'delete']);
export const CRUD_OPS = CrudOp.options;

/** The link kind a set of CRUD operations on a table amounts to */
export const kindForCrud = (ops: readonly CrudOp[]): 'reads' | 'writes' =>
  ops.every((op) => op === 'read') ? 'reads' : 'writes';

/** Behavioural / visual connections */
export const LinkEdge = z.object({
  ...edgeBase,
  kind: z.enum(['navigates', 'calls', 'reads', 'writes', 'emits', 'arrow']),
  /** Table connections only: which operations the caller performs, in CRUD order */
  crud: z.array(CrudOp).optional(),
});

/** Column-to-column foreign key between two tables */
export const ForeignKeyEdge = z.object({
  ...edgeBase,
  kind: z.literal('fk'),
  data: z.object({
    sourceColumnId: Id, // column holding the FK
    targetColumnId: Id, // referenced column
    cardinality: z.enum(['n:1', '1:1']).default('n:1'),
    onDelete: z.enum(['no action', 'cascade', 'set null', 'restrict']).default('no action'),
  }),
});

export const CanvasEdge = z.discriminatedUnion('kind', [LinkEdge, ForeignKeyEdge]);

/* ============================================================
 * Flows — named, ordered paths through the graph
 * ============================================================ */

export const FlowStep = z.object({
  edgeId: Id,
  note: z.string().optional(),
});

export const Flow = z.object({
  id: Id,
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().optional(),
  /** Palette key (e.g. 'violet'); the web app maps it to a theme color */
  color: z.string().optional(),
  /** May be empty: a flow is created first, then recorded step by step */
  steps: z.array(FlowStep),
});

type EdgeLookup = ReadonlyMap<string, { source: string; target: string }>;

/**
 * Checks a flow's steps in order. Each step's edge must exist, appear only once, and (after the
 * first) start from a node the flow already reached. Branching is fine: an endpoint can both write
 * a table and emit an event. Returns one problem (or null) per step.
 */
export function checkFlowSteps(edges: EdgeLookup, steps: readonly { edgeId: string }[]): (string | null)[] {
  const reached = new Set<string>();
  const seen = new Set<string>();
  return steps.map((step, j) => {
    const edge = edges.get(step.edgeId);
    if (!edge) return 'Unknown edge';
    if (seen.has(step.edgeId)) return 'This edge is already in the flow';
    seen.add(step.edgeId);
    const continues = j === 0 || reached.has(edge.source);
    reached.add(edge.source).add(edge.target);
    return continues ? null : 'Step does not continue from a node already in the flow';
  });
}

/** Whether `edgeId` can be appended to a flow with these steps; `reason` explains a refusal */
export function canAppendStep(
  doc: { edges: readonly CanvasEdge[] },
  steps: readonly { edgeId: string }[],
  edgeId: string,
): { ok: true } | { ok: false; reason: string } {
  const edges = new Map(doc.edges.map((e) => [e.id, e]));
  const problem = checkFlowSteps(edges, [...steps, { edgeId }]).at(-1);
  return problem ? { ok: false, reason: problem } : { ok: true };
}

/* ============================================================
 * Features — scopes over the canvas (docs/feature-scopes-plan.md)
 * ============================================================ */

/** What a feature does with an item: uses it as it is, adds it, changes it, or removes it */
export const FeatureRole = z.enum(['uses', 'added', 'changed', 'removed']);
export const FEATURE_ROLES = FeatureRole.options;

export const FeatureItemRef = z.object({
  kind: z.enum(['node', 'edge', 'model']),
  id: Id,
});

export const FeatureItem = z.object({
  ref: FeatureItemRef,
  role: FeatureRole,
  /** Why the feature needs this item */
  note: z.string().optional(),
  progress: z.enum(['todo', 'done']).optional(),
});

export const FeatureStatus = z.enum(['draft', 'in-progress', 'shipped']);

export const Feature = z.object({
  id: Id,
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().optional(),
  /** Palette key (e.g. 'violet'), like flows */
  color: z.string().optional(),
  status: FeatureStatus.default('draft'),
  acceptance: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  items: z.array(FeatureItem).default([]),
  /** Flows that tell the feature's story */
  flowIds: z.array(Id).default([]),
  /** Originals of the nodes and models the feature changes, by id (copied on their first edit) */
  baseline: z
    .object({
      nodes: z.record(Id, CanvasNode).default({}),
      models: z.record(Id, ApiModel).default({}),
    })
    .default({ nodes: {}, models: {} }),
});

/* ============================================================
 * Document
 * ============================================================ */

export const Viewport = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
});

export const CanvasDoc = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(CanvasNode),
    edges: z.array(CanvasEdge),
    flows: z.array(Flow),
    /** Reusable API schemas (DTOs), exported as components.schemas */
    models: z.array(ApiModel).default([]),
    api: ApiSettings.default({
      title: 'Untitled API',
      version: '0.1.0',
      servers: [],
      auth: 'bearer',
      apiKeyHeader: 'X-API-Key',
    }),
    /** The SQL dialect tables are designed for */
    database: DatabaseSettings.default({ dialect: 'postgresql' }),
    /** Feature scopes: which items a feature uses, adds, changes or removes */
    features: z.array(Feature).default([]),
    viewport: Viewport.default({ x: 0, y: 0, zoom: 1 }),
  })
  .superRefine((doc, ctx) => {
    const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
    const edges = new Map(doc.edges.map((e) => [e.id, e]));

    if (nodes.size !== doc.nodes.length)
      ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'Duplicate node ids' });
    if (edges.size !== doc.edges.length)
      ctx.addIssue({ code: 'custom', path: ['edges'], message: 'Duplicate edge ids' });

    // Parents must be frames, and frames don't nest (a child's position is relative to its frame)
    doc.nodes.forEach((n, i) => {
      if (n.parentId && nodes.get(n.parentId)?.type !== 'frame') {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'parentId'],
          message: `Parent ${n.parentId} is missing or not a frame`,
        });
      } else if (n.parentId && n.type === 'frame')
        ctx.addIssue({ code: 'custom', path: ['nodes', i, 'parentId'], message: 'Frames cannot be inside other frames' });
      if (n.type === 'sketch' && n.data.shape === 'freehand' && (n.data.points?.length ?? 0) < 2)
        ctx.addIssue({ code: 'custom', path: ['nodes', i, 'data', 'points'], message: 'A pen stroke needs at least two points' });
    });

    // Edges must point at existing nodes; CRUD operations need a table; FKs must connect real table columns
    doc.edges.forEach((e, i) => {
      const s = nodes.get(e.source);
      const t = nodes.get(e.target);
      if (!s || !t) {
        ctx.addIssue({ code: 'custom', path: ['edges', i], message: 'Edge references a missing node' });
        return;
      }
      if (e.kind !== 'fk') {
        // A link may start at a screen element (a button, a form, ...), never end at one
        const elementId = elementIdOf(e.sourceHandle);
        if (elementId !== null) {
          const element = s.type === 'screen' ? s.data.wireframe?.elements.find((el) => el.id === elementId) : undefined;
          if (!element)
            ctx.addIssue({ code: 'custom', path: ['edges', i, 'sourceHandle'], message: 'Unknown screen element' });
          else if (!isInteractive(element.kind))
            ctx.addIssue({
              code: 'custom',
              path: ['edges', i, 'sourceHandle'],
              message: 'Only buttons, links, forms and lists can start a connection',
            });
        }
        if (elementIdOf(e.targetHandle) !== null)
          ctx.addIssue({ code: 'custom', path: ['edges', i, 'targetHandle'], message: 'A screen element cannot be a target' });
        if (!e.crud) return;
        if (s.type !== 'table' && t.type !== 'table')
          ctx.addIssue({ code: 'custom', path: ['edges', i, 'crud'], message: 'CRUD operations need a table on one end' });
        if (new Set(e.crud).size !== e.crud.length)
          ctx.addIssue({ code: 'custom', path: ['edges', i, 'crud'], message: 'Duplicate CRUD operation' });
        return;
      }
      if (s.type !== 'table' || t.type !== 'table') {
        ctx.addIssue({ code: 'custom', path: ['edges', i], message: 'FK edges must connect two tables' });
        return;
      }
      if (!s.data.columns.some((c) => c.id === e.data.sourceColumnId))
        ctx.addIssue({ code: 'custom', path: ['edges', i, 'data', 'sourceColumnId'], message: 'Unknown source column' });
      if (!t.data.columns.some((c) => c.id === e.data.targetColumnId))
        ctx.addIssue({ code: 'custom', path: ['edges', i, 'data', 'targetColumnId'], message: 'Unknown target column' });
    });

    // Tables: named and unique per schema, unique column names, indexes on existing columns.
    // Names compare case-insensitively, like unquoted SQL identifiers.
    const tableNames = new Set<string>();
    doc.nodes.forEach((n, i) => {
      if (n.type !== 'table') return;
      const base = ['nodes', i];
      const name = n.label.trim().toLowerCase();
      if (!name) {
        ctx.addIssue({ code: 'custom', path: [...base, 'label'], message: 'Table name is required' });
      } else {
        const key = `${n.data.schema.toLowerCase()}.${name}`;
        if (tableNames.has(key))
          ctx.addIssue({ code: 'custom', path: [...base, 'label'], message: `Duplicate table ${n.label}` });
        tableNames.add(key);
      }

      const columnNames = new Set<string>();
      const columnIds = new Set<string>();
      n.data.columns.forEach((c, j) => {
        const colName = c.name.trim().toLowerCase();
        if (columnNames.has(colName))
          ctx.addIssue({
            code: 'custom',
            path: [...base, 'data', 'columns', j, 'name'],
            message: `Duplicate column ${c.name}`,
          });
        if (columnIds.has(c.id))
          ctx.addIssue({ code: 'custom', path: [...base, 'data', 'columns', j], message: 'Duplicate column id' });
        columnNames.add(colName);
        columnIds.add(c.id);
      });

      n.data.indexes.forEach((ix, j) =>
        ix.columnIds.forEach((id, k) => {
          if (!columnIds.has(id))
            ctx.addIssue({
              code: 'custom',
              path: [...base, 'data', 'indexes', j, 'columnIds', k],
              message: 'Index references an unknown column',
            });
        }),
      );
    });

    // Flow steps: see checkFlowSteps
    doc.flows.forEach((f, i) =>
      checkFlowSteps(edges, f.steps).forEach((message, j) => {
        if (message) ctx.addIssue({ code: 'custom', path: ['flows', i, 'steps', j], message });
      }),
    );

    // API: unique model names and field names, and every model reference must resolve.
    // These rules (and the endpoint ones below) keep every valid doc a valid OpenAPI spec.
    const modelIds = new Set(doc.models.map((m) => m.id));
    const modelNames = new Set<string>();
    doc.models.forEach((m, i) => {
      if (modelNames.has(m.name))
        ctx.addIssue({ code: 'custom', path: ['models', i, 'name'], message: `Duplicate model ${m.name}` });
      modelNames.add(m.name);
      const fieldNames = new Set<string>();
      m.fields.forEach((f, j) => {
        if (fieldNames.has(f.name))
          ctx.addIssue({ code: 'custom', path: ['models', i, 'fields', j, 'name'], message: `Duplicate field ${f.name}` });
        fieldNames.add(f.name);
      });
    });

    const checkRef = (t: FieldType, path: (string | number)[]) => {
      const id = modelRefOf(t);
      if (id && !modelIds.has(id)) ctx.addIssue({ code: 'custom', path, message: `Unknown model ${id}` });
    };
    doc.models.forEach((m, i) =>
      m.fields.forEach((f, j) => checkRef(f.type, ['models', i, 'fields', j, 'type'])),
    );

    // Component instances: only on screens (no nesting yet), and they name an existing component
    doc.nodes.forEach((n, i) => {
      if (n.type !== 'screen' && n.type !== 'component') return;
      n.data.wireframe?.elements.forEach((el, j) => {
        if (el.kind !== 'instance') return;
        const path = ['nodes', i, 'data', 'wireframe', 'elements', j, 'componentId'];
        if (n.type === 'component')
          ctx.addIssue({ code: 'custom', path, message: 'Components cannot contain other components' });
        else if (el.componentId !== undefined && nodes.get(el.componentId)?.type !== 'component')
          ctx.addIssue({ code: 'custom', path, message: `Unknown component ${el.componentId}` });
      });
    });

    // Wireframe elements bound to a model (a generated form, list or table) must name an existing one
    doc.nodes.forEach((n, i) => {
      if (n.type !== 'screen' && n.type !== 'component') return;
      n.data.wireframe?.elements.forEach((el, j) => {
        if (el.modelRef !== undefined && !modelIds.has(el.modelRef))
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', i, 'data', 'wireframe', 'elements', j, 'modelRef'],
            message: `Unknown model ${el.modelRef}`,
          });
      });
    });

    // API: unique routes (also across renamed params) and operationIds, path params match the path,
    // params and responses are unique per endpoint, refs resolve
    const routes = new Map<string, string>();
    const operationIds = new Set<string>();
    doc.nodes.forEach((n, i) => {
      if (n.type !== 'endpoint') return;
      const { method, path, spec } = n.data;
      const base = ['nodes', i, 'data'];

      const route = `${method} ${path}`;
      const shape = `${method} ${pathShape(path)}`;
      const clash = routes.get(shape);
      if (clash)
        ctx.addIssue({
          code: 'custom',
          path: [...base, 'path'],
          message: clash === route ? `Duplicate route ${route}` : `${route} is the same route as ${clash}`,
        });
      else routes.set(shape, route);

      // A generated id that clashes because the route clashes is already reported above
      const operationId = spec.operationId ?? defaultOperationId(method, path);
      if (operationIds.has(operationId) && !(clash && !spec.operationId))
        ctx.addIssue({
          code: 'custom',
          path: [...base, 'spec', 'operationId'],
          message: `Duplicate operationId ${operationId}`,
        });
      operationIds.add(operationId);

      const params = new Set<string>();
      spec.params.forEach((p, j) => {
        const key = `${p.in}:${p.in === 'header' ? p.name.toLowerCase() : p.name}`;
        if (params.has(key))
          ctx.addIssue({
            code: 'custom',
            path: [...base, 'spec', 'params', j, 'name'],
            message: `Duplicate ${p.in} parameter ${p.name}`,
          });
        params.add(key);
      });

      const statuses = new Set<string>();
      spec.responses.forEach((r, j) => {
        if (statuses.has(r.status))
          ctx.addIssue({
            code: 'custom',
            path: [...base, 'spec', 'responses', j, 'status'],
            message: `Duplicate response ${r.status}`,
          });
        statuses.add(r.status);
      });

      const inPath = pathParamNames(path).sort();
      const declared = spec.params.filter((p) => p.in === 'path').map((p) => p.name).sort();
      if (inPath.join() !== declared.join())
        ctx.addIssue({
          code: 'custom',
          path: [...base, 'spec', 'params'],
          message: `Path params in ${path} must match declared path parameters`,
        });

      if (spec.requestBody) checkRef(spec.requestBody.type, [...base, 'spec', 'requestBody']);
      spec.responses.forEach((r, j) => r.body && checkRef(r.body, [...base, 'spec', 'responses', j]));
    });

    // Features: structural rules only (conflicts and gaps are warnings, never errors)
    const featureIds = new Set<string>();
    const flowIds = new Set(doc.flows.map((f) => f.id));
    const addedBy = new Map<string, string>();
    const exists = { node: nodes, edge: edges, model: modelIds } as const;
    doc.features.forEach((f, i) => {
      if (featureIds.has(f.id)) ctx.addIssue({ code: 'custom', path: ['features', i, 'id'], message: 'Duplicate feature id' });
      featureIds.add(f.id);

      const roles = new Map<string, FeatureRole>();
      f.items.forEach((item, j) => {
        const key = featureItemKey(item.ref);
        const path = ['features', i, 'items', j];
        if (!exists[item.ref.kind].has(item.ref.id))
          ctx.addIssue({ code: 'custom', path: [...path, 'ref'], message: `Unknown ${item.ref.kind} ${item.ref.id}` });
        if (roles.has(key))
          ctx.addIssue({ code: 'custom', path: [...path, 'ref'], message: 'Item is already in this feature' });
        roles.set(key, item.role);
        if (item.role !== 'added') return;
        const other = addedBy.get(key);
        if (other !== undefined && other !== f.id)
          ctx.addIssue({ code: 'custom', path: [...path, 'role'], message: 'Item is already added by another feature' });
        addedBy.set(key, f.id);
      });

      const checkBaseline = (kind: 'node' | 'model', id: string, original: { id: string; type?: string }) => {
        const path = ['features', i, 'baseline', `${kind}s`, id];
        if (roles.get(featureItemKey({ kind, id })) !== 'changed')
          ctx.addIssue({ code: 'custom', path, message: 'Only changed items keep a baseline' });
        else if (original.id !== id || (kind === 'node' && original.type !== nodes.get(id)?.type))
          ctx.addIssue({ code: 'custom', path, message: 'Baseline does not match the item' });
      };
      Object.entries(f.baseline.nodes).forEach(([id, n]) => checkBaseline('node', id, n));
      Object.entries(f.baseline.models).forEach(([id, m]) => checkBaseline('model', id, m));

      const seenFlows = new Set<string>();
      f.flowIds.forEach((id, j) => {
        if (!flowIds.has(id) || seenFlows.has(id))
          ctx.addIssue({
            code: 'custom',
            path: ['features', i, 'flowIds', j],
            message: seenFlows.has(id) ? 'Duplicate flow' : `Unknown flow ${id}`,
          });
        seenFlows.add(id);
      });
    });
  });

/** Identifies a feature item across kinds, e.g. `node:abc` */
export const featureItemKey = (ref: { kind: string; id: string }) => `${ref.kind}:${ref.id}`;

/* ============================================================
 * Types
 * ============================================================ */

export type CanvasNode = z.infer<typeof CanvasNode>;
export type NodeType = CanvasNode['type'];
export type HttpMethod = z.infer<typeof HttpMethod>;
export type CanvasEdge = z.infer<typeof CanvasEdge>;
export type EdgeKind = CanvasEdge['kind'];
export type CrudOp = z.infer<typeof CrudOp>;
export type Column = z.infer<typeof Column>;
export type TableNode = z.infer<typeof TableNode>;
export type FrameNode = z.infer<typeof FrameNode>;
export type SketchNode = z.infer<typeof SketchNode>;
export type ForeignKeyEdge = z.infer<typeof ForeignKeyEdge>;
export type Flow = z.infer<typeof Flow>;
export type FeatureRole = z.infer<typeof FeatureRole>;
export type FeatureItemRef = z.infer<typeof FeatureItemRef>;
export type FeatureItem = z.infer<typeof FeatureItem>;
export type FeatureStatus = z.infer<typeof FeatureStatus>;
export type Feature = z.infer<typeof Feature>;
export type CanvasDoc = z.infer<typeof CanvasDoc>;

/** Components by id with their name and wireframe, for rendering and describing instances */
export type WireComponents = ReadonlyMap<string, { name: string; wireframe?: z.infer<typeof Wireframe> }>;

export const wireComponentsOf = (doc: Pick<CanvasDoc, 'nodes'>): WireComponents =>
  new Map(
    doc.nodes.flatMap((n) =>
      n.type === 'component' ? [[n.id, { name: n.label || 'Component', wireframe: n.data.wireframe }] as const] : [],
    ),
  );

/** Names of the screens that place a component */
export const componentUsages = (doc: Pick<CanvasDoc, 'nodes'>, componentId: string): string[] =>
  doc.nodes.flatMap((n) =>
    n.type === 'screen' && n.data.wireframe?.elements.some((el) => el.componentId === componentId)
      ? [n.label || 'Untitled screen']
      : [],
  );

export const emptyCanvas = (): CanvasDoc => ({
  schemaVersion: 1,
  nodes: [],
  edges: [],
  flows: [],
  models: [],
  api: { title: 'Untitled API', version: '0.1.0', servers: [], auth: 'bearer', apiKeyHeader: 'X-API-Key' },
  database: { dialect: 'postgresql' },
  features: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
