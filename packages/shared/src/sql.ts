import type { CanvasDoc, Column, ForeignKeyEdge, TableNode } from './canvas';
import { DIALECTS, type DatabaseSettings, type SqlDialect } from './database';
import type { FeatureAnnotations } from './feature-scope';
import { roleText } from './feature-scope';
import { translateDefault, translateType, type Translation } from './sql-types';

/* ============================================================
 * SQL DDL (PostgreSQL, MySQL, MariaDB, SQLite) — pure, used by the table dialog and the SQL export
 * ============================================================ */

/** Words every dialect reserves; names like `user` or `order` must be quoted */
const RESERVED = new Set(
  (
    'all and as asc between by case check column constraint create cross default delete desc distinct drop else end ' +
    'exists false for foreign from full group having in index inner insert into is join key left like limit not null ' +
    'of on or order outer primary references right select set table then to true union unique update user using ' +
    'values when where with'
  ).split(' '),
);

/** Quotes identifiers that aren't plain lower-case SQL names: backticks in MySQL/MariaDB, double quotes elsewhere */
export const sqlIdent = (name: string, dialect: SqlDialect = 'postgresql') => {
  if (/^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED.has(name)) return name;
  return dialect === 'mysql' || dialect === 'mariadb' ? `\`${name.replaceAll('`', '``')}\`` : `"${name.replaceAll('"', '""')}"`;
};

/**
 * Schema-qualified name in PostgreSQL. SQLite has no schemas, and in MySQL/MariaDB a schema is a
 * separate database whose name the script can't know, so there the schema prefixes the name (`shop_orders`).
 */
export const sqlTableName = (t: TableNode, dialect: SqlDialect = 'postgresql') => {
  if (t.data.schema === 'public') return sqlIdent(t.label, dialect);
  if (dialect !== 'postgresql') return sqlIdent(`${t.data.schema}_${t.label}`, dialect);
  return `${sqlIdent(t.data.schema, dialect)}.${sqlIdent(t.label, dialect)}`;
};

type DocTables = Pick<CanvasDoc, 'nodes' | 'edges'> & { database?: DatabaseSettings };

export type SqlOptions = {
  /** Target dialect; defaults to the doc's database dialect */
  dialect?: SqlDialect;
  /** A feature's marks: a comment per table and column it adds, changes or drops */
  feature?: FeatureAnnotations;
};

const projectDialect = (doc: DocTables): SqlDialect => doc.database?.dialect ?? 'postgresql';

/** `FOREIGN KEY (...) REFERENCES ...` for one `fk` edge leaving `table`; null when an end is missing */
export function foreignKeyClause(edge: ForeignKeyEdge, table: TableNode, doc: DocTables, dialect: SqlDialect): string | null {
  const target = doc.nodes.find((n): n is TableNode => n.id === edge.target && n.type === 'table');
  const from = table.data.columns.find((c) => c.id === edge.data.sourceColumnId);
  const to = target?.data.columns.find((c) => c.id === edge.data.targetColumnId);
  if (!target || !from || !to) return null;
  const onDelete = edge.data.onDelete === 'no action' ? '' : ` ON DELETE ${edge.data.onDelete.toUpperCase()}`;
  return `FOREIGN KEY (${sqlIdent(from.name, dialect)}) REFERENCES ${sqlTableName(target, dialect)} (${sqlIdent(to.name, dialect)})${onDelete}`;
}

/** `FOREIGN KEY (...) REFERENCES ...` clauses from the doc's `fk` edges leaving this table */
function foreignKeys(table: TableNode, doc: DocTables, dialect: SqlDialect): string[] {
  return doc.edges.flatMap((edge) =>
    edge.kind === 'fk' && edge.source === table.id ? (foreignKeyClause(edge, table, doc, dialect) ?? []) : [],
  );
}

/** Columns in a key, an index or a foreign key (either end) */
function indexedColumnIds(table: TableNode, doc: DocTables): Set<string> {
  const ids = new Set(table.data.columns.filter((c) => c.primaryKey || c.unique).map((c) => c.id));
  for (const ix of table.data.indexes) ix.columnIds.forEach((id) => ids.add(id));
  for (const e of doc.edges) {
    if (e.kind !== 'fk') continue;
    if (e.source === table.id) ids.add(e.data.sourceColumnId);
    if (e.target === table.id) ids.add(e.data.targetColumnId);
  }
  return ids;
}

type Line = { sql: string; comment?: string };

/**
 * One column's definition (`name type [PRIMARY KEY] [NOT NULL] [UNIQUE] [DEFAULT ...]`), translated
 * from the doc's dialect. `inlinePrimaryKey: false` leaves PRIMARY KEY out (for ALTER TABLE).
 */
export function columnSql(
  c: Column,
  table: TableNode,
  doc: DocTables,
  { dialect = projectDialect(doc), inlinePrimaryKey = true }: { dialect?: SqlDialect; inlinePrimaryKey?: boolean } = {},
): Line {
  const translation: Translation = { from: projectDialect(doc), to: dialect };
  const { type, autoIncrement, note } = translateType(c.type, translation, { indexed: indexedColumnIds(table, doc).has(c.id) });
  const parts = [sqlIdent(c.name, dialect), type];
  const singlePk = inlinePrimaryKey && c.primaryKey && table.data.columns.filter((x) => x.primaryKey).length === 1;
  if (autoIncrement && (dialect === 'mysql' || dialect === 'mariadb')) parts.push('AUTO_INCREMENT');
  if (singlePk) parts.push('PRIMARY KEY');
  // SQLite only auto-increments an INTEGER PRIMARY KEY
  if (singlePk && autoIncrement && dialect === 'sqlite' && type === 'integer') parts.push('AUTOINCREMENT');
  if (!singlePk && (!c.nullable || c.primaryKey)) parts.push('NOT NULL');
  if (c.unique && !c.primaryKey) parts.push('UNIQUE');
  if (c.default) parts.push(`DEFAULT ${translateDefault(c.default, translation, type)}`);
  return { sql: parts.join(' '), comment: note };
}

/** An index's name: its own, or `<table>_<columns>_idx` */
export const indexName = (ix: TableNode['data']['indexes'][number], table: TableNode) => {
  const columns = new Map(table.data.columns.map((c) => [c.id, c]));
  return ix.name || `${table.label}_${ix.columnIds.flatMap((id) => columns.get(id)?.name ?? []).join('_')}_idx`;
};

/** `CREATE [UNIQUE] INDEX ...`; null when none of its columns exist */
export function createIndexSql(ix: TableNode['data']['indexes'][number], table: TableNode, dialect: SqlDialect): string | null {
  const byId = new Map(table.data.columns.map((c) => [c.id, c]));
  const cols = ix.columnIds.flatMap((id) => byId.get(id) ?? []);
  if (cols.length === 0) return null;
  const list = cols.map((c) => sqlIdent(c.name, dialect)).join(', ');
  return `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${sqlIdent(indexName(ix, table), dialect)} ON ${sqlTableName(table, dialect)} (${list});`;
}

/** Column list lines; comments go after the comma so the SQL stays valid */
const renderLines = (lines: Line[]) =>
  lines
    .map((l, i) => `  ${l.sql}${i < lines.length - 1 ? ',' : ''}${l.comment ? ` -- ${l.comment}` : ''}`)
    .join('\n');

/**
 * CREATE TABLE plus its indexes. Foreign keys come from the doc's `fk` edges leaving this table;
 * `inlineForeignKeys: false` leaves them out (a full script adds them once every table exists).
 * Types and defaults are written for the doc's dialect and translated when `dialect` differs.
 */
export function tableToDdl(
  table: TableNode,
  doc: DocTables,
  { dialect = projectDialect(doc), inlineForeignKeys = true, feature }: SqlOptions & { inlineForeignKeys?: boolean } = {},
): string {
  const { columns, indexes } = table.data;
  const pk = columns.filter((c) => c.primaryKey);
  const columnList = (cols: Column[]) => cols.map((c) => sqlIdent(c.name, dialect)).join(', ');

  const lines: Line[] = columns.map((c) => {
    const { sql, comment: note } = columnSql(c, table, doc, { dialect });
    const mark = feature?.columns.get(table.id)?.get(c.id);
    return { sql, comment: [mark && `${feature!.featureName}: ${mark}`, note].filter(Boolean).join('; ') || undefined };
  });
  if (pk.length > 1) lines.push({ sql: `PRIMARY KEY (${columnList(pk)})` });
  if (inlineForeignKeys) lines.push(...foreignKeys(table, doc, dialect).map((sql) => ({ sql })));

  const name = sqlTableName(table, dialect);
  const statements = [`${feature ? `${featureTableComment(table, feature)}\n` : ''}CREATE TABLE ${name} (\n${renderLines(lines)}\n);`];

  for (const ix of indexes) {
    const sql = createIndexSql(ix, table, dialect);
    if (sql) statements.push(sql);
  }

  return statements.join('\n\n');
}

/**
 * The whole database as one script: schemas (PostgreSQL), tables and indexes, then foreign keys as ALTER TABLE
 * statements, so the script runs whatever the table order (cycles included). SQLite can't add
 * foreign keys later, so there they stay inline (SQLite doesn't need the referenced table yet).
 */
/** `-- users: changed by Wishlist; drops nickname` */
export function featureTableComment(table: TableNode, feature: FeatureAnnotations): string {
  const dropped = feature.dropped.get(table.id);
  const role = roleText(feature.roles.get(`node:${table.id}`), feature.featureName);
  return `-- ${table.label}: ${role}${dropped?.length ? `; drops ${dropped.join(', ')}` : ''}`;
}

export function toSqlSchema(doc: DocTables, { dialect = projectDialect(doc), feature }: SqlOptions = {}): string {
  const tables = doc.nodes.filter((n): n is TableNode => n.type === 'table');
  const schemas = [...new Set(tables.map((t) => t.data.schema).filter((s) => s !== 'public'))];
  const { label, minVersion } = DIALECTS[dialect];
  const inline = dialect === 'sqlite';

  const header = [`-- Generated by RuneArch for ${label} ${minVersion}+${feature ? `, feature ${feature.featureName}` : ''}`];
  if (dialect !== 'postgresql' && schemas.length) header.push(`-- ${label} has no schemas: tables in ${schemas.join(', ')} are named <schema>_<table>`);

  const statements = [
    header.join('\n'),
    ...(dialect === 'postgresql' ? schemas.map((s) => `CREATE SCHEMA IF NOT EXISTS ${sqlIdent(s, dialect)};`) : []),
    ...(dialect === 'sqlite' ? ['PRAGMA foreign_keys = ON;'] : []),
    ...tables.map((t) => tableToDdl(t, doc, { dialect, inlineForeignKeys: inline, feature })),
    ...(inline
      ? []
      : tables.flatMap((t) =>
          foreignKeys(t, doc, dialect).map((fk) => `ALTER TABLE ${sqlTableName(t, dialect)} ADD ${fk};`),
        )),
  ];
  return `${statements.join('\n\n')}\n`;
}

/**
 * Switches the doc's database dialect, converting every column type and default into it,
 * so the tables stay valid for the new database. Auto-increment is kept as the dialect
 * writes it: serial types (PostgreSQL), `auto_increment` (MySQL/MariaDB), `integer` (SQLite).
 */
export function convertDocDialect<T extends DocTables>(doc: T, dialect: SqlDialect): T {
  const translation: Translation = { from: projectDialect(doc), to: dialect };
  if (translation.from === dialect) return doc;
  const nodes = doc.nodes.map((n) => {
    if (n.type !== 'table') return n;
    const indexed = indexedColumnIds(n, doc);
    const columns = n.data.columns.map((c) => {
      const { type, autoIncrement, note } = translateType(c.type, translation, { indexed: indexed.has(c.id) });
      const stored = autoIncrement && (dialect === 'mysql' || dialect === 'mariadb') ? `${type} auto_increment` : type;
      return {
        ...c,
        type: stored,
        ...(c.default ? { default: translateDefault(c.default, translation, type) } : {}),
        // What the conversion lost (e.g. an array type) stays visible in the column note
        ...(note ? { note: [c.note?.trim(), note].filter(Boolean).join('; ') } : {}),
      };
    });
    return { ...n, data: { ...n.data, columns } };
  });
  return { ...doc, nodes, database: { ...doc.database, dialect } };
}
