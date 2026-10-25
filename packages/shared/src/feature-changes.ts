import { modelRefOf, type ApiModel, type FieldType } from './api';
import {
  featureItemKey,
  type CanvasDoc,
  type CanvasNode,
  type Column,
  type FeatureItemRef,
  type FeatureRole,
} from './canvas';
import { diffModel, diffNode, type DiffEntry } from './feature-diff';
import { featureById, sameValue } from './feature';
import { featureConflicts, partName } from './feature-lifecycle';
import { featureDependencies } from './feature-scope';
import { elementIdOf } from './wireframe';

/*
 * The changeset of a feature: per item its role, note and diff against the baseline, plus
 * warnings. Warnings never block anything (docs/feature-scopes-plan.md §1); they inform the panel
 * and, later, the exports.
 */

export type FeatureWarning = {
  code: 'backfill' | 'breaking' | 'uncalled-endpoint' | 'unused-table' | 'outside-flow' | 'drift' | 'conflict' | 'dependency';
  message: string;
  /** The item the warning is about (for `outside-flow`: the node to add as existing) */
  ref?: FeatureItemRef;
};

export type ItemChange = {
  ref: FeatureItemRef;
  role: FeatureRole;
  note?: string;
  /** Changed nodes and models with a baseline: what differs from it */
  entries: DiffEntry[];
  /** Screens: element links (edges from its buttons, forms, ...) the feature adds */
  addedLinks: string[];
};

export type ApiBump = 'major' | 'minor' | 'patch';

export type FeatureChanges = {
  featureId: string;
  items: ItemChange[];
  warnings: FeatureWarning[];
  /** What the feature's API changes amount to, if it changes the API at all */
  apiBump: ApiBump | null;
  /** `api.version` bumped accordingly, when it is a semantic version */
  nextApiVersion?: string;
};

const nodeName = (n: CanvasNode | undefined) =>
  !n ? '?' : n.type === 'endpoint' ? `${n.data.method} ${n.data.path}` : n.label || n.type;

const AUTH_LEVEL = { public: 0, user: 1, admin: 2 } as const;

/** Models that endpoints accept as request bodies (directly or as list items) */
const requestModels = (doc: CanvasDoc) =>
  new Set(
    doc.nodes.flatMap((n) => {
      const id = n.type === 'endpoint' && n.data.spec.requestBody ? modelRefOf(n.data.spec.requestBody.type) : undefined;
      return id ? [id] : [];
    }),
  );

const typeOf = (v: unknown) => (v as { type?: FieldType } | undefined)?.type;

/** Breaking changes of an endpoint against its baseline: what an existing client would trip over */
function breakingEndpoint(name: string, entries: DiffEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.type === 'prop') {
      const field = e.path.at(-1);
      if (field === 'method' || field === 'path') out.push(`${name}: ${e.label.toLowerCase()} changed from ${String(e.before)} to ${String(e.after)}`);
      else if (field === 'auth' && AUTH_LEVEL[e.after as keyof typeof AUTH_LEVEL] > AUTH_LEVEL[e.before as keyof typeof AUTH_LEVEL])
        out.push(`${name}: auth tightened from ${String(e.before)} to ${String(e.after)}`);
      else if (field === 'requestBody') {
        const before = e.before as { type: FieldType; required: boolean } | undefined;
        const after = e.after as { type: FieldType; required: boolean } | undefined;
        if (after?.required && (!before || !before.required)) out.push(`${name}: request body is now required`);
        else if (before && after && !sameValue(before.type, after.type)) out.push(`${name}: request body type changed`);
      }
      continue;
    }
    if (e.label === 'Param') {
      const after = e.after as { required?: boolean; in?: string; type?: unknown } | undefined;
      const before = e.before as { required?: boolean; type?: unknown } | undefined;
      if (e.type === 'added' && after?.required && after.in !== 'path') out.push(`${name}: new required param ${e.name}`);
      if (e.type === 'changed' && after?.required && !before?.required) out.push(`${name}: param ${e.name} is now required`);
      if (e.type === 'changed' && !sameValue(before?.type, after?.type)) out.push(`${name}: param ${e.name} changed type`);
    }
    if (e.label === 'Response') {
      if (e.type === 'removed') out.push(`${name}: response ${e.name} removed`);
      if (e.type === 'changed' && e.fields?.includes('body')) out.push(`${name}: response ${e.name} body changed`);
    }
  }
  return out;
}

/** Breaking changes of a model: fields clients rely on that went away or got stricter */
function breakingModel(model: ApiModel, entries: DiffEntry[], inRequests: boolean): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.type === 'prop' && e.path[0] === 'name') out.push(`${String(e.before)} renamed to ${String(e.after)}`);
    if (e.type === 'prop' || e.label !== 'Field') continue;
    const before = e.before as { required?: boolean } | undefined;
    const after = e.after as { required?: boolean } | undefined;
    if (e.type === 'removed') out.push(`${model.name}.${e.name} removed`);
    if (e.type === 'changed' && !sameValue(typeOf(e.before), typeOf(e.after))) out.push(`${model.name}.${e.name} changed type`);
    if (inRequests && e.type === 'changed' && after?.required && !before?.required)
      out.push(`${model.name}.${e.name} is now required in requests`);
    if (inRequests && e.type === 'added' && after?.required) out.push(`${model.name}.${e.name} is a new required field in requests`);
  }
  return out;
}

/** New NOT NULL columns without a default on an existing table: its rows need values first */
function backfills(table: CanvasNode, entries: DiffEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.type === 'prop' || e.label !== 'Column') continue;
    const after = e.after as Column | undefined;
    const before = e.before as Column | undefined;
    if (!after || after.nullable || after.default) continue;
    if (e.type === 'added' || (e.type === 'changed' && before?.nullable))
      out.push(`${table.label}.${after.name} is NOT NULL without a default: existing rows need a backfill`);
  }
  return out;
}

/** "1.4.2" bumped; undefined for versions that aren't x.y.z */
export function bumpVersion(version: string, bump: ApiBump): string | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return undefined;
  const [major, minor, patch] = m.slice(1).map(Number) as [number, number, number];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const BUMP_ORDER: ApiBump[] = ['patch', 'minor', 'major'];
const maxBump = (a: ApiBump | null, b: ApiBump) => (a && BUMP_ORDER.indexOf(a) >= BUMP_ORDER.indexOf(b) ? a : b);

export function featureChanges(doc: CanvasDoc, featureId: string): FeatureChanges | null {
  const feature = featureById(doc, featureId);
  if (!feature) return null;
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const models = new Map(doc.models.map((m) => [m.id, m]));
  const inRequests = requestModels(doc);
  const inFeature = new Set(feature.items.map((i) => featureItemKey(i.ref)));
  const warnings: FeatureWarning[] = [];
  // Raised inside the item callbacks below (an object, so the type isn't narrowed to null)
  const api: { bump: ApiBump | null } = { bump: null };

  const items = feature.items.map((item): ItemChange => {
    const { ref, role } = item;
    let entries: DiffEntry[] = [];
    const node = ref.kind === 'node' ? nodes.get(ref.id) : undefined;
    const model = ref.kind === 'model' ? models.get(ref.id) : undefined;
    const baseNode = feature.baseline.nodes[ref.id];
    const baseModel = feature.baseline.models[ref.id];
    if (role === 'changed' && node && baseNode) entries = diffNode(baseNode, node);
    if (role === 'changed' && model && baseModel) entries = diffModel(baseModel, model);
    const warn = (code: FeatureWarning['code'], messages: string[]) =>
      messages.forEach((message) => warnings.push({ code, message, ref }));

    // Breaking changes and the API version they call for
    const isApi = node?.type === 'endpoint' || ref.kind === 'model';
    if (isApi && role !== 'uses') {
      const name = node ? nodeName(node) : (model?.name ?? '?');
      if (role === 'removed') {
        warn('breaking', [`${name} is removed`]);
        api.bump = maxBump(api.bump, 'major');
      } else if (role === 'added') api.bump = maxBump(api.bump, 'minor');
      else {
        const breaking = node ? breakingEndpoint(name, entries) : model ? breakingModel(model, entries, inRequests.has(model.id)) : [];
        warn('breaking', breaking);
        const adds = entries.some((e) => e.type === 'added');
        if (breaking.length) api.bump = maxBump(api.bump, 'major');
        else if (adds) api.bump = maxBump(api.bump, 'minor');
        else if (entries.length) api.bump = maxBump(api.bump, 'patch');
      }
    }

    if (node?.type === 'table' && role === 'changed') warn('backfill', backfills(node, entries));

    // Coverage: new parts nothing uses
    if (role === 'added' && node?.type === 'endpoint') {
      const called =
        doc.edges.some((e) => e.target === node.id && e.kind !== 'arrow' && e.kind !== 'fk') ||
        doc.flows.some((f) => f.steps.some((s) => doc.edges.find((e) => e.id === s.edgeId)?.target === node.id));
      if (!called) warn('uncalled-endpoint', [`${nodeName(node)} is not called by any screen, service or flow`]);
    }
    if (role === 'added' && node?.type === 'table') {
      const used = doc.edges.some((e) => (e.source === node.id || e.target === node.id) && e.kind !== 'arrow' && e.kind !== 'fk');
      if (!used) warn('unused-table', [`${node.label} is not read or written by anything`]);
    }

    // Drift: another feature changes the same item from a different original
    if (role === 'changed' && (baseNode || baseModel)) {
      for (const other of doc.features) {
        if (other.id === feature.id || other.status === 'shipped') continue;
        const theirs = ref.kind === 'node' ? other.baseline.nodes[ref.id] : other.baseline.models[ref.id];
        if (theirs && !sameValue(theirs, baseNode ?? baseModel))
          warn('drift', [`${other.name} changes ${node ? nodeName(node) : (model?.name ?? '?')} too, starting from a different version`]);
      }
    }

    const addedLinks =
      node?.type === 'screen'
        ? doc.edges
            .filter((e) => e.source === node.id && elementIdOf(e.sourceHandle) !== null)
            .filter((e) => feature.items.some((i) => i.ref.kind === 'edge' && i.ref.id === e.id && i.role === 'added'))
            .map((e) => e.id)
        : [];

    return { ref, role, ...(item.note && { note: item.note }), entries, addedLinks };
  });

  // Feature flows passing through nodes the feature doesn't list (offer "add as existing")
  const edges = new Map(doc.edges.map((e) => [e.id, e]));
  const outside = new Set<string>();
  for (const flowId of feature.flowIds) {
    const flow = doc.flows.find((f) => f.id === flowId);
    for (const step of flow?.steps ?? []) {
      const edge = edges.get(step.edgeId);
      for (const id of edge ? [edge.source, edge.target] : []) {
        if (outside.has(id) || inFeature.has(featureItemKey({ kind: 'node', id }))) continue;
        outside.add(id);
        warnings.push({
          code: 'outside-flow',
          message: `Flow ${flow!.name} passes through ${nodeName(nodes.get(id))}, which is not in the feature`,
          ref: { kind: 'node', id },
        });
      }
    }
  }

  // Other open features working on the same parts, and unshipped features this one relies on
  for (const c of featureConflicts(doc, featureId))
    for (const ref of c.items)
      warnings.push({ code: 'conflict', message: `${c.name} also changes or removes ${partName(doc, ref)}`, ref });
  for (const d of featureDependencies(doc, featureId))
    warnings.push({
      code: 'dependency',
      message: `Depends on ${d.name}, which is not shipped yet: ${d.items.map((r) => partName(doc, r)).join(', ')}`,
    });

  const nextApiVersion = api.bump ? bumpVersion(doc.api.version, api.bump) : undefined;
  return { featureId, items, warnings, apiBump: api.bump, ...(nextApiVersion && { nextApiVersion }) };
}
