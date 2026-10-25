import { syncPathParams, type CanvasDoc, type Param, type Wireframe } from '@flowcanvas/shared';
import type { NodeOf } from '../canvas/mapping';
import { applyScreenEdit, elementLinksOf, replaceNode, type ElementLink } from '../store/docOps';
import { newId } from '../store/nodeFactory';
import { tidyWireframe } from './wireframe/wireframeDraft';
import { fromTypeDraft, STRING_TYPE, toPrimitive, toTypeDraft, type TypeDraft } from './typeDraft';
import type { IssueMapper } from './validation';

/*
 * Draft <-> node conversions for the Screen, Service, Job and Endpoint dialogs. Drafts hold plain form
 * values (strings, booleans); conversion back trims text and drops empty optionals.
 */

const optional = (s: string) => s.trim() || undefined;

/** One entry per non-blank line */
const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/* ---------- Screen ---------- */

/**
 * The wireframe is edited as a whole (template, device, editor), so the draft holds it as is; null = none.
 * `links` are the edges starting at its elements; applyScreenEdit syncs them on save.
 */
export type ScreenDraft = {
  label: string;
  route: string;
  state: string;
  notes: string;
  wireframe: Wireframe | null;
  links: ElementLink[];
};

export const toScreenDraft = (node: NodeOf<'screen'>, doc: CanvasDoc): ScreenDraft => ({
  label: node.label,
  route: node.data.route ?? '',
  state: node.data.state.join('\n'),
  notes: node.notes ?? '',
  wireframe: node.data.wireframe ?? null,
  links: elementLinksOf(doc, node.id),
});

/** The part of a screen draft the Wireframe tab edits (with its own undo history) */
export type ScreenDesign = Pick<ScreenDraft, 'wireframe' | 'links'>;

/** The doc with a screen draft applied: the node plus its element links */
export const buildScreen = (node: NodeOf<'screen'>) => (doc: CanvasDoc, draft: ScreenDraft) =>
  applyScreenEdit(doc, fromScreenDraft(node, draft), draft.links);

export const fromScreenDraft = (node: NodeOf<'screen'>, draft: ScreenDraft): NodeOf<'screen'> => ({
  ...node,
  label: draft.label.trim(),
  notes: optional(draft.notes),
  data: {
    ...node.data,
    route: optional(draft.route),
    state: lines(draft.state),
    wireframe: draft.wireframe ? tidyWireframe(draft.wireframe) : undefined,
  },
});

export const screenMapper: IssueMapper = {
  node: ([key, sub]) =>
    key === 'label'
      ? 'label'
      : key === 'notes'
        ? 'notes'
        : key === 'data' && (sub === 'route' || sub === 'state' || sub === 'wireframe')
          ? sub
          : null,
};

/* ---------- Component ---------- */

/** Like a screen draft; `links` stays empty (component elements don't link), so the Wireframe tab is shared */
export type ComponentDraft = {
  label: string;
  props: string;
  notes: string;
  wireframe: Wireframe | null;
  links: ElementLink[];
};

export const toComponentDraft = (node: NodeOf<'component'>): ComponentDraft => ({
  label: node.label,
  props: node.data.props.join('\n'),
  notes: node.notes ?? '',
  wireframe: node.data.wireframe ?? null,
  links: [],
});

export const fromComponentDraft = (node: NodeOf<'component'>, draft: ComponentDraft): NodeOf<'component'> => ({
  ...node,
  label: draft.label.trim(),
  notes: optional(draft.notes),
  data: {
    ...node.data,
    props: lines(draft.props),
    wireframe: draft.wireframe ? tidyWireframe(draft.wireframe) : undefined,
  },
});

export const componentMapper: IssueMapper = {
  node: ([key, sub]) =>
    key === 'label'
      ? 'label'
      : key === 'notes'
        ? 'notes'
        : key === 'data' && (sub === 'props' || sub === 'wireframe')
          ? sub
          : null,
};

/* ---------- Frame ---------- */

export type FrameDraft = { label: string; lane: NodeOf<'frame'>['data']['lane']; notes: string };

export const toFrameDraft = (node: NodeOf<'frame'>): FrameDraft => ({
  label: node.label,
  lane: node.data.lane,
  notes: node.notes ?? '',
});

export const fromFrameDraft = (node: NodeOf<'frame'>, draft: FrameDraft): NodeOf<'frame'> => ({
  ...node,
  label: draft.label.trim(),
  notes: optional(draft.notes),
  data: { ...node.data, lane: draft.lane },
});

export const frameMapper: IssueMapper = {
  node: ([key]) => (key === 'label' ? 'label' : key === 'notes' ? 'notes' : null),
};

/* ---------- Service ---------- */

export type ServiceDraft = { label: string; methods: string; notes: string };

export const toServiceDraft = (node: NodeOf<'service'>): ServiceDraft => ({
  label: node.label,
  methods: node.data.methods.join('\n'),
  notes: node.notes ?? '',
});

export const fromServiceDraft = (node: NodeOf<'service'>, draft: ServiceDraft): NodeOf<'service'> => ({
  ...node,
  label: draft.label.trim(),
  notes: optional(draft.notes),
  data: { ...node.data, methods: lines(draft.methods) },
});

export const serviceMapper: IssueMapper = {
  node: ([key, sub]) =>
    key === 'label' ? 'label' : key === 'notes' ? 'notes' : key === 'data' && sub === 'methods' ? 'methods' : null,
};

/* ---------- Job ---------- */

export type JobDraft = { label: string; trigger: NodeOf<'job'>['data']['trigger']; schedule: string; notes: string };

export const toJobDraft = (node: NodeOf<'job'>): JobDraft => ({
  label: node.label,
  trigger: node.data.trigger,
  schedule: node.data.schedule ?? '',
  notes: node.notes ?? '',
});

/** Only scheduled jobs keep a schedule; spaces inside the cron expression collapse to one */
export const fromJobDraft = (node: NodeOf<'job'>, draft: JobDraft): NodeOf<'job'> => ({
  ...node,
  label: draft.label.trim(),
  notes: optional(draft.notes),
  data: {
    ...node.data,
    trigger: draft.trigger,
    schedule: draft.trigger === 'cron' ? optional(draft.schedule.trim().split(/\s+/).join(' ')) : undefined,
  },
});

export const jobMapper: IssueMapper = {
  node: ([key, sub]) =>
    key === 'label'
      ? 'label'
      : key === 'notes'
        ? 'notes'
        : key === 'data' && (sub === 'trigger' || sub === 'schedule')
          ? sub
          : null,
};

/** A hint when a cron expression doesn't have 5 fields (6 with seconds, or an @macro); null when it looks fine */
export const cronHint = (schedule: string): string | null => {
  const s = schedule.trim();
  if (!s || /^@\w+$/.test(s)) return null;
  const fields = s.split(/\s+/).length;
  return fields === 5 || fields === 6 ? null : `Expected 5 fields (minute hour day month weekday), got ${fields}`;
};

/* ---------- Endpoint ---------- */

type Endpoint = NodeOf<'endpoint'>;
type Spec = Endpoint['data']['spec'];

export type ParamDraft = {
  id: string;
  name: string;
  in: Param['in'];
  type: TypeDraft;
  required: boolean;
  description: string;
};

export type ResponseDraft = { status: string; description: string; hasBody: boolean; body: TypeDraft };

export type EndpointDraft = {
  method: Endpoint['data']['method'];
  path: string;
  auth: Endpoint['data']['auth'];
  summary: string;
  description: string;
  /** Comma-separated */
  tags: string;
  operationId: string;
  deprecated: boolean;
  params: ParamDraft[];
  hasBody: boolean;
  body: { type: TypeDraft; contentType: string; required: boolean };
  responses: ResponseDraft[];
};

export const newParamDraft = (name: string, location: Param['in']): ParamDraft => ({
  id: newId(),
  name,
  in: location,
  type: { ...STRING_TYPE },
  required: location === 'path',
  description: '',
});

export const newResponseDraft = (status = ''): ResponseDraft => ({
  status,
  description: '',
  hasBody: false,
  body: { ...STRING_TYPE },
});

/** Path params follow {...} in the path (kept in sync while typing) */
export const syncParamDrafts = (path: string, params: readonly ParamDraft[]) =>
  syncPathParams(path, params, (name) => newParamDraft(name, 'path'));

export const toEndpointDraft = (node: Endpoint): EndpointDraft => {
  const { spec } = node.data;
  return {
    method: node.data.method,
    path: node.data.path,
    auth: node.data.auth,
    summary: spec.summary ?? '',
    description: spec.description ?? '',
    tags: spec.tags.join(', '),
    operationId: spec.operationId ?? '',
    deprecated: spec.deprecated,
    params: spec.params.map((p) => ({
      id: p.id,
      name: p.name,
      in: p.in,
      type: toTypeDraft(p.type),
      required: p.required,
      description: p.description ?? '',
    })),
    hasBody: spec.requestBody !== undefined,
    body: {
      type: spec.requestBody ? toTypeDraft(spec.requestBody.type) : { ...STRING_TYPE },
      contentType: spec.requestBody?.contentType ?? 'application/json',
      required: spec.requestBody?.required ?? true,
    },
    responses: spec.responses.map((r) => ({
      status: r.status,
      description: r.description,
      hasBody: r.body !== undefined,
      body: r.body ? toTypeDraft(r.body) : { ...STRING_TYPE },
    })),
  };
};

export const fromEndpointDraft = (node: Endpoint, draft: EndpointDraft): Endpoint => {
  const path = draft.path.trim();
  const params: Param[] = syncParamDrafts(path, draft.params).map((p) => ({
    id: p.id,
    name: p.name.trim(),
    in: p.in,
    type: toPrimitive(p.type),
    required: p.in === 'path' || p.required,
    description: optional(p.description),
  }));
  const spec: Spec = {
    ...node.data.spec,
    summary: optional(draft.summary),
    description: optional(draft.description),
    operationId: optional(draft.operationId),
    deprecated: draft.deprecated,
    tags: [
      ...new Set(
        draft.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ],
    params,
    requestBody: draft.hasBody
      ? {
          contentType: draft.body.contentType.trim() || 'application/json',
          type: fromTypeDraft(draft.body.type),
          required: draft.body.required,
        }
      : undefined,
    responses: draft.responses.map((r) => ({
      status: r.status.trim(),
      description: r.description.trim(),
      body: r.hasBody ? fromTypeDraft(r.body) : undefined,
    })),
  };
  return { ...node, data: { ...node.data, method: draft.method, path, auth: draft.auth, spec } };
};

const GENERAL_FIELDS: Record<string, keyof EndpointDraft> = {
  method: 'method',
  path: 'path',
  auth: 'auth',
  summary: 'summary',
  description: 'description',
  tags: 'tags',
  operationId: 'operationId',
};

export const endpointMapper: IssueMapper = {
  node: ([key, sub, specKey, index, field]) => {
    if (key !== 'data') return null;
    if (sub !== 'spec') return GENERAL_FIELDS[String(sub)] ?? null;
    if (specKey === 'params') return typeof index === 'number' ? `params.${index}.name` : 'path';
    if (specKey === 'requestBody') return 'body.type.base';
    if (specKey === 'responses') {
      if (typeof index !== 'number') return 'responses';
      return field === 'status' ? `responses.${index}.status` : `responses.${index}.body.base`;
    }
    return GENERAL_FIELDS[String(specKey)] ?? null;
  },
};

/** Candidate doc for single-node dialogs */
export const withNode =
  <N extends Parameters<typeof replaceNode>[1], D>(node: N, fromDraft: (node: N, draft: D) => N) =>
  (doc: CanvasDoc, draft: D) =>
    replaceNode(doc, fromDraft(node, draft));
