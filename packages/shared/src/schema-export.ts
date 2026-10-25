import type { CanvasDoc, Column, ForeignKeyEdge, FrameNode, TableNode } from './canvas';
import { DIALECTS, type DatabaseSettings } from './database';
import { roleText, type FeatureAnnotations } from './feature-scope';
import type { FeatureRole } from './canvas';
import { toSqlSchema, type SqlOptions } from './sql';

/* ============================================================
 * Database schema exports — pure, used by the schema dialog and the export API.
 * Each format renders every table of the doc plus its `fk` edges.
 * ============================================================ */

type DocTables = Pick<CanvasDoc, 'nodes' | 'edges'> & { database?: DatabaseSettings };

const dialectLabel = (doc: DocTables) => DIALECTS[doc.database?.dialect ?? 'postgresql'].label;

export type ResolvedFk = { edge: ForeignKeyEdge; source: TableNode; from: Column; target: TableNode; to: Column };

const tablesOf = (doc: DocTables) => doc.nodes.filter((n): n is TableNode => n.type === 'table');

/** FK edges with both ends resolved to tables and columns, in doc order */
export function resolveForeignKeys(doc: DocTables): ResolvedFk[] {
  const tables = new Map(tablesOf(doc).map((t) => [t.id, t]));
  return doc.edges.flatMap((edge) => {
    if (edge.kind !== 'fk') return [];
    const source = tables.get(edge.source);
    const target = tables.get(edge.target);
    const from = source?.data.columns.find((c) => c.id === edge.data.sourceColumnId);
    const to = target?.data.columns.find((c) => c.id === edge.data.targetColumnId);
    return source && target && from && to ? [{ edge, source, from, target, to }] : [];
  });
}

/* ------------------------------------------------------------
 * DBML (dbdiagram.io) — https://dbml.dbdiagram.io/docs
 * ------------------------------------------------------------ */

const dbmlIdent = (name: string) => (/^[A-Za-z_]\w*$/.test(name) ? name : `"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`);

const dbmlTableName = (t: TableNode) =>
  t.data.schema === 'public' ? dbmlIdent(t.label) : `${dbmlIdent(t.data.schema)}.${dbmlIdent(t.label)}`;

/** Plain types stay bare (`varchar(255)`, `numeric(10,2)`, `text[]`); anything else is quoted */
const dbmlType = (type: string) => (/^[\w.]+(\([\w\s,]*\))?(\[\])*$/.test(type) ? type : `"${type.replaceAll('"', '\\"')}"`);

/** Single-quoted DBML string; multi-line text uses a triple-quoted block */
const dbmlString = (text: string) => {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  return text.includes('\n') ? `'''\n${escaped}\n'''` : `'${escaped}'`;
};

/** Numbers, booleans, null and quoted strings are literals; other defaults are SQL expressions */
const dbmlDefault = (value: string) => {
  const v = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(v) || /^(true|false|null)$/i.test(v)) return v;
  if (/^'([^']|'')*'$/.test(v)) return dbmlString(v.slice(1, -1).replaceAll("''", "'"));
  return `\`${v.replaceAll('`', '\\`')}\``;
};

const dbmlSettings = (settings: string[]) => (settings.length ? ` [${settings.join(', ')}]` : '');

const indent = (lines: string[], by = '  ') => lines.map((l) => (l ? `${by}${l}` : l));

const tableRole = (feature: FeatureAnnotations | undefined, t: TableNode): FeatureRole | undefined =>
  feature?.roles.get(`node:${t.id}`);

/** The table's role and the columns it drops, e.g. "changed by Wishlist; drops nickname" */
const tableFeatureNote = (feature: FeatureAnnotations, t: TableNode) => {
  const dropped = feature.dropped.get(t.id);
  return `${roleText(tableRole(feature, t), feature.featureName)}${dropped?.length ? `; drops ${dropped.join(', ')}` : ''}`;
};

function dbmlTable(table: TableNode, feature?: FeatureAnnotations): string {
  const { columns, indexes } = table.data;
  const columnById = new Map(columns.map((c) => [c.id, c]));
  const pk = columns.filter((c) => c.primaryKey);

  const body = columns.map((c) => {
    const settings: string[] = [];
    if (c.primaryKey && pk.length === 1) settings.push('pk');
    else if (!c.nullable || c.primaryKey) settings.push('not null');
    if (c.unique && !c.primaryKey) settings.push('unique');
    if (c.default) settings.push(`default: ${dbmlDefault(c.default)}`);
    const mark = feature?.columns.get(table.id)?.get(c.id);
    const note = [c.note?.trim(), mark && `${feature!.featureName}: ${mark}`].filter(Boolean).join('\n');
    if (note) settings.push(`note: ${dbmlString(note)}`);
    return `${dbmlIdent(c.name)} ${dbmlType(c.type)}${dbmlSettings(settings)}`;
  });

  const indexLines: string[] = [];
  const columnsRef = (cols: Column[]) =>
    cols.length === 1 ? dbmlIdent(cols[0]!.name) : `(${cols.map((c) => dbmlIdent(c.name)).join(', ')})`;
  if (pk.length > 1) indexLines.push(`${columnsRef(pk)} [pk]`);
  for (const ix of indexes) {
    const cols = ix.columnIds.flatMap((id) => columnById.get(id) ?? []);
    if (cols.length === 0) continue;
    const settings = [...(ix.unique ? ['unique'] : []), ...(ix.name ? [`name: ${dbmlString(ix.name)}`] : [])];
    indexLines.push(`${columnsRef(cols)}${dbmlSettings(settings)}`);
  }
  if (indexLines.length) body.push('', 'indexes {', ...indent(indexLines), '}');

  const tableNote = [table.notes?.trim(), feature && tableFeatureNote(feature, table)].filter(Boolean).join('\n');
  if (tableNote) body.push('', `Note: ${dbmlString(tableNote)}`);

  return [`Table ${dbmlTableName(table)} {`, ...indent(body), '}'].join('\n');
}

/** Frames holding tables become table groups (names made unique) */
function dbmlTableGroups(doc: DocTables, tables: TableNode[]): string[] {
  const frames = new Map(
    doc.nodes.filter((n): n is FrameNode => n.type === 'frame' && n.label.trim() !== '').map((f) => [f.id, f]),
  );
  const members = new Map<string, TableNode[]>();
  for (const t of tables) {
    if (t.parentId && frames.has(t.parentId)) members.set(t.parentId, [...(members.get(t.parentId) ?? []), t]);
  }
  const used = new Set<string>();
  return [...members].map(([frameId, groupTables]) => {
    const base = frames.get(frameId)!.label.trim();
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    return [`TableGroup ${dbmlIdent(name)} {`, ...indent(groupTables.map(dbmlTableName)), '}'].join('\n');
  });
}

const ROLE_GROUP: Record<FeatureRole, (name: string) => string> = {
  added: (name) => `New in ${name}`,
  changed: (name) => `Changed by ${name}`,
  removed: (name) => `Removed by ${name}`,
  uses: () => 'Existing',
};

/** With a feature, tables are grouped by their role in it instead of by frame */
function dbmlRoleGroups(feature: FeatureAnnotations, tables: TableNode[]): string[] {
  return (['added', 'changed', 'removed', 'uses'] as const).flatMap((role) => {
    const members = tables.filter((t) => (tableRole(feature, t) ?? 'uses') === role);
    if (members.length === 0) return [];
    return [[`TableGroup ${dbmlIdent(ROLE_GROUP[role](feature.featureName))} {`, ...indent(members.map(dbmlTableName)), '}'].join('\n')];
  });
}

/**
 * The doc's tables, foreign keys and groups as DBML, ready to paste into dbdiagram.io. Types stay as
 * written. With a feature, tables are grouped by role and notes say what it adds, changes or drops.
 */
export function toDbml(doc: DocTables, { feature }: { feature?: FeatureAnnotations } = {}): string {
  const tables = tablesOf(doc);
  const refs = resolveForeignKeys(doc).map(({ edge, source, from, target, to }) => {
    const op = edge.data.cardinality === '1:1' ? '-' : '>';
    const settings = edge.data.onDelete === 'no action' ? [] : [`delete: ${edge.data.onDelete}`];
    return `Ref: ${dbmlTableName(source)}.${dbmlIdent(from.name)} ${op} ${dbmlTableName(target)}.${dbmlIdent(to.name)}${dbmlSettings(settings)}`;
  });

  const blocks = [
    `// Generated by RuneArch. Database: ${dialectLabel(doc)}.${feature ? ` Feature: ${feature.featureName}.` : ''} Format: DBML (https://dbml.dbdiagram.io/docs)`,
    ...tables.map((t) => dbmlTable(t, feature)),
    ...(refs.length ? [refs.join('\n')] : []),
    ...(feature ? dbmlRoleGroups(feature, tables) : dbmlTableGroups(doc, tables)),
  ];
  return `${blocks.join('\n\n')}\n`;
}

/* ------------------------------------------------------------
 * Mermaid ER diagram — https://mermaid.js.org/syntax/entityRelationshipDiagram.html
 * ------------------------------------------------------------ */

const mermaidEntity = (t: TableNode) => {
  const name = t.data.schema === 'public' ? t.label : `${t.data.schema}.${t.label}`;
  return /^[A-Za-z_][\w-]*$/.test(name) ? name : `"${name.replaceAll('"', "'")}"`;
};

/** Mermaid attribute types and names allow letters, digits, `_`, `-`, `()` and `[]` only */
const mermaidWord = (text: string) => text.replace(/[^\w\-()[\]]/g, '_').replace(/^(?=[^A-Za-z_*])/, '_');

const mermaidComment = (parts: string[]) =>
  parts.length ? ` "${parts.join('; ').replace(/\s+/g, ' ').replaceAll('"', "'")}"` : '';

function mermaidTable(table: TableNode, fkColumnIds: Set<string>, feature?: FeatureAnnotations): string[] {
  const entity = mermaidEntity(table);
  const notes = [
    ...(table.notes?.trim() ? [`%% ${entity}: ${table.notes.trim().replace(/\s+/g, ' ')}`] : []),
    ...(feature ? [`%% ${entity}: ${tableFeatureNote(feature, table)}`] : []),
  ];
  if (table.data.columns.length === 0) return [...notes, entity];

  const attributes = table.data.columns.map((c) => {
    const type = mermaidWord(c.type);
    const name = mermaidWord(c.name);
    const keys = [
      ...(c.primaryKey ? ['PK'] : []),
      ...(fkColumnIds.has(c.id) ? ['FK'] : []),
      ...(c.unique && !c.primaryKey ? ['UK'] : []),
    ];
    const comment = [
      ...(name !== c.name ? [`name: ${c.name}`] : []),
      ...(type !== c.type ? [`type: ${c.type}`] : []),
      ...(!c.nullable && !c.primaryKey ? ['not null'] : []),
      ...(c.default ? [`default: ${c.default}`] : []),
      ...(c.note?.trim() ? [c.note.trim()] : []),
      ...(feature?.columns.get(table.id)?.get(c.id) ? [`${feature.featureName}: ${feature.columns.get(table.id)!.get(c.id)!}`] : []),
    ];
    return `${type} ${name}${keys.length ? ` ${keys.join(', ')}` : ''}${mermaidComment(comment)}`;
  });
  return [...notes, `${entity} {`, ...indent(attributes), '}'];
}

/** The doc's tables and foreign keys as a Mermaid `erDiagram` (renders in GitHub/GitLab markdown) */
export function toMermaidEr(doc: DocTables, { feature }: { feature?: FeatureAnnotations } = {}): string {
  const fks = resolveForeignKeys(doc);
  const fkColumnIds = new Set(fks.map((fk) => fk.from.id));
  const relationships = fks.map(({ edge, source, from, target }) => {
    // The referenced row is required unless the FK column may be null
    const left = from.nullable && !from.primaryKey ? '|o' : '||';
    const right = edge.data.cardinality === '1:1' ? 'o|' : 'o{';
    return `${mermaidEntity(target)} ${left}--${right} ${mermaidEntity(source)} : "${from.name.replaceAll('"', "'")}"`;
  });

  const lines = [
    `%% Generated by RuneArch. Database: ${dialectLabel(doc)}${feature ? `. Feature: ${feature.featureName}` : ''}`,
    'erDiagram',
    ...indent(tablesOf(doc).flatMap((t) => mermaidTable(t, fkColumnIds, feature))),
    ...indent(relationships),
  ];
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------
 * Registry: one entry per format. The schema dialog and `GET /projects/:id/schema.<extension>`
 * are driven by it, so a new generator (e.g. Pydantic, SQLAlchemy, Drizzle) is one entry.
 * ------------------------------------------------------------ */

export type SchemaExport = {
  label: string;
  /** File extension, also the export URL suffix */
  extension: string;
  mimeType: string;
  /** Whether `dialect` changes the output (SQL); DBML and Mermaid keep types as written */
  dialectAware: boolean;
  render(doc: DocTables, options?: SqlOptions): string;
};

export const SCHEMA_EXPORTS = {
  dbml: { label: 'DBML', extension: 'dbml', mimeType: 'text/plain', dialectAware: false, render: toDbml },
  mermaid: { label: 'Mermaid', extension: 'mmd', mimeType: 'text/vnd.mermaid', dialectAware: false, render: toMermaidEr },
  sql: { label: 'SQL', extension: 'sql', mimeType: 'application/sql', dialectAware: true, render: toSqlSchema },
} as const satisfies Record<string, SchemaExport>;

export type SchemaExportFormat = keyof typeof SCHEMA_EXPORTS;

export const schemaExportByExtension = (extension: string): SchemaExport | undefined =>
  Object.values(SCHEMA_EXPORTS).find((f) => f.extension === extension);
