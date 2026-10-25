import type { ApiModel } from './api';
import { featureItemKey, type CanvasDoc, type CanvasEdge, type CanvasNode, type Column, type FeatureRole } from './canvas';
import { featureById } from './feature';
import { featureChanges, type FeatureChanges } from './feature-changes';
import { changedFields, describeEntry, type DiffEntry } from './feature-diff';
import { featureMigration, type MigrationOptions } from './feature-migration';
import { featureDependencies, scopeToFeature } from './feature-scope';
import { typeLabel } from './models';
import { tableToDdl } from './sql';
import { elementIdOf } from './wireframe';

/*
 * The hand-off for building a feature (docs/feature-scopes-plan.md §5): a brief (what exists, what
 * the feature adds, changes and removes, with DDL, routes, screens, flows and warnings), a task
 * list per lane, and the migration. Pure, so the export dialog and the API render the same text.
 */

/** Roles as the brief names them */
const GROUP = { added: 'new', changed: 'changed', removed: 'removed', uses: 'existing' } as const;
type Group = (typeof GROUP)[FeatureRole];
type Grouped<T> = Record<Group, T[]>;
const grouped = <T>(): Grouped<T> => ({ new: [], changed: [], removed: [], existing: [] });

type Common = { name: string; note?: string; changes?: string[] };
export type TableBrief = Common & { ddl: string };
export type EndpointBrief = Common & { auth: string; summary?: string; params: string[]; body?: string; responses: string[] };
export type ModelBrief = Common & { fields: string[] };
export type ScreenBrief = Common & { kind: 'screen' | 'component'; route?: string; elements: string[] };
export type NodeBrief = Common & { kind: string; details?: string };

export type FeatureBrief = {
  feature: { id: string; name: string; status: string; description?: string; acceptance: string[]; openQuestions: string[] };
  flows: { name: string; description?: string; steps: string[] }[];
  tables: Grouped<TableBrief>;
  endpoints: Grouped<EndpointBrief>;
  models: Grouped<ModelBrief>;
  screens: Grouped<ScreenBrief>;
  other: Grouped<NodeBrief>;
  /** Connections between parts: what calls, reads, writes, emits what; foreign keys */
  connections: Grouped<string>;
  warnings: string[];
  api?: { bump: string; from: string; to?: string };
  dependsOn: { feature: string; items: string[] }[];
};

const nodeName = (n: CanvasNode | undefined) =>
  !n ? '?' : n.type === 'endpoint' ? `${n.data.method} ${n.data.path}` : n.label || n.type;

/** "Cart · Place order → POST /orders · calls" */
function edgeText(doc: CanvasDoc, e: CanvasEdge): string {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const source = nodes.get(e.source);
  const target = nodes.get(e.target);
  if (e.kind === 'fk') {
    const col = (n: CanvasNode | undefined, id: string) => (n?.type === 'table' ? n.data.columns.find((c) => c.id === id)?.name : undefined) ?? '?';
    return `${nodeName(source)}.${col(source, e.data.sourceColumnId)} → ${nodeName(target)}.${col(target, e.data.targetColumnId)} (foreign key${e.data.onDelete === 'no action' ? '' : `, on delete ${e.data.onDelete}`})`;
  }
  const elementId = elementIdOf(e.sourceHandle);
  const element =
    elementId !== null && source?.type === 'screen' ? source.data.wireframe?.elements.find((el) => el.id === elementId) : undefined;
  const from = element ? `${nodeName(source)} · ${element.text?.trim() || element.kind}` : nodeName(source);
  const what = e.label ?? (e.crud?.length ? `${e.kind}: ${e.crud.join(', ')}` : e.kind);
  return `${from} → ${nodeName(target)} · ${what}`;
}

const fieldLine = (f: ApiModel['fields'][number], models: readonly ApiModel[]) =>
  `${f.name}: ${typeLabel(f.type, models)}${f.required ? '' : ' (optional)'}${f.nullable ? ' (nullable)' : ''}${f.description ? ` — ${f.description}` : ''}`;

/** Everything a feature touches, grouped by role, for the brief; null for an unknown feature */
export function featureBrief(doc: CanvasDoc, featureId: string): FeatureBrief | null {
  const feature = featureById(doc, featureId);
  const scoped = scopeToFeature(doc, featureId);
  const changes = featureChanges(doc, featureId);
  if (!feature || !scoped || !changes) return null;
  const sdoc = scoped.doc;
  const roles = scoped.roles!;
  const byItem = new Map(changes.items.map((c) => [featureItemKey(c.ref), c]));
  const common = (kind: 'node' | 'model', id: string, name: string): Common => {
    const c = byItem.get(`${kind}:${id}`);
    return { name, ...(c?.note && { note: c.note }), ...(c?.entries.length && { changes: c.entries.map(describeEntry) }) };
  };
  const groupOf = (kind: 'node' | 'edge' | 'model', id: string): Group => GROUP[roles.get(`${kind}:${id}`) ?? 'uses'];

  const brief: FeatureBrief = {
    feature: {
      id: feature.id,
      name: feature.name,
      status: feature.status,
      ...(feature.description && { description: feature.description }),
      acceptance: feature.acceptance,
      openQuestions: feature.openQuestions,
    },
    flows: sdoc.flows.map((f) => ({
      name: f.name,
      ...(f.description && { description: f.description }),
      steps: f.steps.flatMap((s) => {
        const e = sdoc.edges.find((x) => x.id === s.edgeId);
        return e ? [`${edgeText(sdoc, e)}${s.note ? ` — ${s.note}` : ''}`] : [];
      }),
    })),
    tables: grouped(),
    endpoints: grouped(),
    models: grouped(),
    screens: grouped(),
    other: grouped(),
    connections: grouped(),
    // Dependencies have their own section
    warnings: changes.warnings.filter((w) => w.code !== 'dependency').map((w) => w.message),
    ...(changes.apiBump && { api: { bump: changes.apiBump, from: doc.api.version, ...(changes.nextApiVersion && { to: changes.nextApiVersion }) } }),
    dependsOn: featureDependencies(doc, featureId).map((d) => ({
      feature: d.name,
      items: d.items.map((ref) => (ref.kind === 'model' ? (doc.models.find((m) => m.id === ref.id)?.name ?? '?') : ref.kind === 'node' ? nodeName(doc.nodes.find((n) => n.id === ref.id)) : edgeText(doc, doc.edges.find((e) => e.id === ref.id)!))),
    })),
  };

  for (const n of sdoc.nodes) {
    if (n.type === 'frame' || n.type === 'sketch') continue;
    const g = groupOf('node', n.id);
    const base = common('node', n.id, nodeName(n));
    switch (n.type) {
      case 'table':
        brief.tables[g].push({ ...base, ddl: tableToDdl(n, sdoc) });
        break;
      case 'endpoint': {
        const { spec } = n.data;
        brief.endpoints[g].push({
          ...base,
          auth: n.data.auth,
          ...(spec.summary && { summary: spec.summary }),
          params: spec.params.map((p) => `${p.in} ${p.name}: ${typeLabel(p.type, sdoc.models)}${p.required || p.in === 'path' ? ' (required)' : ''}`),
          ...(spec.requestBody && { body: typeLabel(spec.requestBody.type, sdoc.models) }),
          responses: spec.responses.map((r) => `${r.status}${r.body ? ` ${typeLabel(r.body, sdoc.models)}` : ''}${r.description ? ` — ${r.description}` : ''}`),
        });
        break;
      }
      case 'screen':
      case 'component':
        brief.screens[g].push({
          ...base,
          kind: n.type,
          ...(n.type === 'screen' && n.data.route && { route: n.data.route }),
          elements: (n.data.wireframe?.elements ?? []).map((el) => `${el.kind}${el.text ? ` "${el.text}"` : ''}${el.items?.length ? ` [${el.items.join(', ')}]` : ''}`),
        });
        break;
      default: {
        const details =
          n.type === 'service' ? n.data.methods.join(', ') : n.type === 'job' ? [n.data.trigger, n.data.schedule].filter(Boolean).join(' ') : n.type === 'store' ? n.data.keys.join(', ') : n.data.baseUrl;
        brief.other[g].push({ ...base, kind: n.type, ...(details && { details }) });
      }
    }
  }
  for (const m of sdoc.models)
    brief.models[groupOf('model', m.id)].push({ ...common('model', m.id, m.name), fields: m.fields.map((f) => fieldLine(f, sdoc.models)) });
  for (const e of sdoc.edges) if (e.kind !== 'arrow') brief.connections[groupOf('edge', e.id)].push(edgeText(sdoc, e));
  return brief;
}

/* ------------------------------------------------------------ Markdown */

const TITLE: Record<Group, string> = { new: 'New', changed: 'Changed', removed: 'Removed', existing: 'Existing (used as is)' };
const ORDER: Group[] = ['new', 'changed', 'removed', 'existing'];

const bullets = (lines: readonly string[], indent = '') => lines.map((l) => `${indent}- ${l}`);

function section<T extends Common>(title: string, groups: Grouped<T>, body: (item: T, group: Group) => string[]): string[] {
  if (ORDER.every((g) => groups[g].length === 0)) return [];
  const out = [`## ${title}`, ''];
  for (const g of ORDER) {
    if (groups[g].length === 0) continue;
    out.push(`### ${TITLE[g]}`, '');
    for (const item of groups[g]) {
      out.push(`#### ${item.name}`, '');
      if (item.note) out.push(`> ${item.note}`, '');
      if (item.changes?.length) out.push('Changes:', '', ...bullets(item.changes.map((c) => `\`${c}\``)), '');
      out.push(...body(item, g));
    }
  }
  return out;
}

/** The brief as Markdown: a hand-off for a developer or an AI */
export function featureBriefMarkdown(doc: CanvasDoc, featureId: string, options: MigrationOptions = {}): string | null {
  const brief = featureBrief(doc, featureId);
  if (!brief) return null;
  const { feature } = brief;
  const out = [`# Feature: ${feature.name}`, '', `Status: ${feature.status}`, ''];
  if (feature.description) out.push(feature.description, '');
  out.push(
    'Parts marked **existing** are already built and only used; **new**, **changed** and **removed** parts are the work. ' +
      'Changes are listed against the version before this feature.',
    '',
  );
  if (feature.acceptance.length) out.push('## Acceptance criteria', '', ...bullets(feature.acceptance.map((a) => `[ ] ${a}`)), '');
  if (feature.openQuestions.length) out.push('## Open questions', '', ...bullets(feature.openQuestions), '');
  if (brief.dependsOn.length)
    out.push('## Depends on', '', ...brief.dependsOn.map((d) => `- ${d.feature} (not shipped yet): ${d.items.join(', ')}`), '');
  if (brief.flows.length) {
    out.push('## Flows', '');
    for (const f of brief.flows) {
      out.push(`### ${f.name}`, '');
      if (f.description) out.push(f.description, '');
      out.push(...f.steps.map((s, i) => `${i + 1}. ${s}`), '');
    }
  }
  out.push(...section('Database', brief.tables, (t) => ['```sql', t.ddl, '```', '']));
  out.push(
    ...section('API endpoints', brief.endpoints, (e) => [
      ...bullets([
        `Auth: ${e.auth}`,
        ...(e.summary ? [`Summary: ${e.summary}`] : []),
        ...(e.params.length ? [`Params: ${e.params.join('; ')}`] : []),
        ...(e.body ? [`Body: ${e.body}`] : []),
        `Responses: ${e.responses.join('; ')}`,
      ]),
      '',
    ]),
  );
  out.push(...section('API models', brief.models, (m) => [...(m.fields.length ? bullets(m.fields) : ['(no fields)']), '']));
  out.push(
    ...section('Screens and components', brief.screens, (s) => [
      ...(s.route ? [`Route: \`${s.route}\``, ''] : []),
      ...(s.elements.length ? ['Layout:', '', ...bullets(s.elements), ''] : []),
    ]),
  );
  out.push(...section('Services, jobs, stores and external systems', brief.other, (n) => [`${n.kind}${n.details ? `: ${n.details}` : ''}`, '']));
  if (ORDER.some((g) => brief.connections[g].length)) {
    out.push('## Connections', '');
    for (const g of ORDER) if (brief.connections[g].length) out.push(`### ${TITLE[g]}`, '', ...bullets(brief.connections[g]), '');
  }
  if (brief.warnings.length || brief.api) {
    out.push('## Warnings', '');
    if (brief.api) out.push(`- API: ${brief.api.bump} change (${brief.api.from}${brief.api.to ? ` → ${brief.api.to}` : ''})`);
    out.push(...bullets(brief.warnings), '');
  }
  const migration = featureMigration(doc, featureId, options);
  if (migration && !migration.up.includes('-- No database changes')) out.push('## Database migration', '', '```sql', migration.up.trim(), '```', '');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export const featureBriefJson = (doc: CanvasDoc, featureId: string): string | null => {
  const brief = featureBrief(doc, featureId);
  return brief && `${JSON.stringify(brief, null, 2)}\n`;
};

/* ------------------------------------------------------------ Tasks */

export type Lane = 'Database' | 'Backend' | 'Frontend';
export type FeatureTask = { lane: Lane; text: string; done: boolean };

const LANE: Record<CanvasNode['type'], Lane> = {
  table: 'Database',
  endpoint: 'Backend',
  service: 'Backend',
  job: 'Backend',
  external: 'Backend',
  screen: 'Frontend',
  component: 'Frontend',
  store: 'Frontend',
  frame: 'Frontend',
  sketch: 'Frontend',
};

const KIND_NAME: Record<CanvasNode['type'], string> = {
  table: 'table',
  endpoint: 'endpoint',
  service: 'service',
  job: 'job',
  external: 'external system',
  screen: 'screen',
  component: 'component',
  store: 'store',
  frame: 'frame',
  sketch: 'note',
};

/** One task per change of a changed item: "Add column `wish_count` to table `users`" */
function entryTask(entry: DiffEntry, kind: string, name: string): string {
  const where = `${kind} \`${name}\``;
  if (entry.type === 'prop') {
    const text = describeEntry(entry);
    return `Change ${text.charAt(0).toLowerCase()}${text.slice(1)} on ${where}`;
  }
  const what = `${entry.label.toLowerCase()} \`${entry.name}\``;
  if (entry.type === 'added') {
    const c = entry.label === 'Column' ? (entry.after as Column) : undefined;
    const backfill = c && !c.nullable && !c.default && !c.primaryKey ? ' (NOT NULL without a default: backfill existing rows)' : '';
    return `Add ${what} to ${where}${backfill}`;
  }
  if (entry.type === 'removed') return `${entry.label === 'Column' || entry.label === 'Index' ? 'Drop' : 'Remove'} ${what} from ${where}`;
  const details = changedFields(entry);
  return `Change ${what} on ${where}${details ? `: ${details}` : ''}`;
}

/** The feature's work as tasks per lane: new, changed and removed parts and connections */
export function featureTasks(doc: CanvasDoc, featureId: string): FeatureTask[] | null {
  const feature = featureById(doc, featureId);
  const changes: FeatureChanges | null = featureChanges(doc, featureId);
  if (!feature || !changes) return null;
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const tasks: FeatureTask[] = [];
  for (const item of feature.items) {
    const done = item.progress === 'done';
    const change = changes.items.find((c) => c.ref.kind === item.ref.kind && c.ref.id === item.ref.id);
    // The item's note goes with its first task only
    let note = item.note;
    const push = (lane: Lane, text: string) => {
      tasks.push({ lane, text: note ? `${text} — ${note}` : text, done });
      note = undefined;
    };
    if (item.ref.kind === 'edge') {
      const e = doc.edges.find((x) => x.id === item.ref.id);
      if (!e || item.role === 'uses') continue;
      const source = nodes.get(e.source);
      const lane: Lane = e.kind === 'fk' ? 'Database' : source ? LANE[source.type] : 'Backend';
      const verb =
        e.kind === 'fk'
          ? { added: 'Add foreign key', changed: 'Change foreign key', removed: 'Drop foreign key' }[item.role]
          : { added: 'Connect', changed: 'Update connection', removed: 'Remove connection' }[item.role];
      push(lane, `${verb}: ${edgeText(doc, e)}`);
      continue;
    }
    const model = item.ref.kind === 'model' ? doc.models.find((m) => m.id === item.ref.id) : undefined;
    const node = item.ref.kind === 'node' ? nodes.get(item.ref.id) : undefined;
    if (!model && !node) continue;
    const lane: Lane = node ? LANE[node.type] : 'Backend';
    const kind = node ? KIND_NAME[node.type] : 'model';
    const name = node ? nodeName(node) : model!.name;
    if (item.role === 'added') push(lane, `${node?.type === 'table' ? 'Create' : 'Add'} ${kind} \`${name}\`${node?.type === 'screen' && node.data.route ? ` (\`${node.data.route}\`)` : ''}`);
    else if (item.role === 'removed') push(lane, `${node?.type === 'table' ? 'Drop' : 'Remove'} ${kind} \`${name}\``);
    else if (item.role === 'changed') {
      const entries = change?.entries ?? [];
      if (entries.length === 0) push(lane, `Update ${kind} \`${name}\``);
      for (const entry of entries) push(lane, entryTask(entry, kind, name));
    }
  }
  return tasks;
}

const LANES: Lane[] = ['Database', 'Backend', 'Frontend'];

export function featureTasksMarkdown(doc: CanvasDoc, featureId: string): string | null {
  const tasks = featureTasks(doc, featureId);
  const feature = featureById(doc, featureId);
  if (!tasks || !feature) return null;
  const out = [`# ${feature.name}: tasks`, ''];
  for (const lane of LANES) {
    const list = tasks.filter((t) => t.lane === lane);
    if (list.length) out.push(`## ${lane}`, '', ...list.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`), '');
  }
  if (feature.acceptance.length) out.push('## Acceptance', '', ...feature.acceptance.map((a) => `- [ ] ${a}`), '');
  if (tasks.length === 0 && feature.acceptance.length === 0) out.push('Nothing to do yet: the feature has no new, changed or removed parts.', '');
  return `${out.join('\n').trim()}\n`;
}

/* ------------------------------------------------------------ Registry */

export type FeatureExport = {
  label: string;
  /** File name, also the export URL suffix: /projects/:id/features/:featureId/<file> */
  file: string;
  mimeType: string;
  /** Whether `dialect` changes the output */
  dialectAware: boolean;
  /** Null for an unknown feature */
  render(doc: CanvasDoc, featureId: string, options?: MigrationOptions): string | null;
};

export const FEATURE_EXPORTS = {
  brief: { label: 'Brief', file: 'brief.md', mimeType: 'text/markdown', dialectAware: true, render: featureBriefMarkdown },
  briefJson: { label: 'Brief (JSON)', file: 'brief.json', mimeType: 'application/json', dialectAware: false, render: featureBriefJson },
  tasks: { label: 'Tasks', file: 'tasks.md', mimeType: 'text/markdown', dialectAware: false, render: featureTasksMarkdown },
  migrationUp: {
    label: 'Migration (up)',
    file: 'migration.up.sql',
    mimeType: 'application/sql',
    dialectAware: true,
    render: (doc: CanvasDoc, featureId: string, options?: MigrationOptions) => featureMigration(doc, featureId, options)?.up ?? null,
  },
  migrationDown: {
    label: 'Migration (down)',
    file: 'migration.down.sql',
    mimeType: 'application/sql',
    dialectAware: true,
    render: (doc: CanvasDoc, featureId: string, options?: MigrationOptions) => featureMigration(doc, featureId, options)?.down ?? null,
  },
} as const satisfies Record<string, FeatureExport>;

export type FeatureExportFormat = keyof typeof FEATURE_EXPORTS;

export const featureExportByFile = (file: string): FeatureExport | undefined =>
  Object.values(FEATURE_EXPORTS).find((f) => f.file === file);
