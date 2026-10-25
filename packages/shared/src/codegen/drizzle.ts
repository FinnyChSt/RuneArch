import { toCamel, toPascal } from '../api';
import type { CanvasDoc, Column, TableNode } from '../canvas';
import { DIALECTS, type DatabaseSettings, type SqlDialect } from '../database';
import { roleText } from '../feature-scope';
import { resolveForeignKeys, type ResolvedFk } from '../schema-export';
import { indexName } from '../sql';
import { sqlTypeInfo, type SqlTypeInfo } from '../sql-types';
import type { CodegenOptions } from './options';
import { uniqueName } from './python';
import { entityName, fkRelations, tableName, usesSchema } from './tables';
import { jsDoc, tsString as str } from './typescript';

/* ============================================================
 * Drizzle ORM schema from the tables, for the project dialect (pg-core, mysql-core or
 * sqlite-core): a table per table with typed column builders, keys, defaults, foreign keys and
 * indexes, then `relations()` per table for the query API. Types drizzle has no builder for keep
 * their SQL through a `customType` helper.
 * ============================================================ */

type DocTables = Pick<CanvasDoc, 'nodes' | 'edges'> & { database?: DatabaseSettings };

const CORE = {
  postgresql: { module: 'drizzle-orm/pg-core', table: 'pgTable', anyColumn: 'AnyPgColumn' },
  mysql: { module: 'drizzle-orm/mysql-core', table: 'mysqlTable', anyColumn: 'AnyMySqlColumn' },
  mariadb: { module: 'drizzle-orm/mysql-core', table: 'mysqlTable', anyColumn: 'AnyMySqlColumn' },
  sqlite: { module: 'drizzle-orm/sqlite-core', table: 'sqliteTable', anyColumn: 'AnySQLiteColumn' },
} as const;

/** Builders PostgreSQL types map to by name, when the type isn't in a known family */
const PG_EXTRA = new Set(['inet', 'cidr', 'macaddr', 'macaddr8', 'interval', 'point', 'line']);

/** Every name the module may import or declare; table consts must not shadow them */
const RESERVED = new Set(
  (
    'sql relations customType sqlType pgTable mysqlTable sqliteTable pgSchema index uniqueIndex primaryKey ' +
    'AnyPgColumn AnyMySqlColumn AnySQLiteColumn uuid smallint smallserial integer serial bigint bigserial boolean text ' +
    'varchar char numeric real doublePrecision date time timestamp json jsonb tinyint int decimal float double ' +
    'datetime blob inet cidr macaddr macaddr8 interval point line ' +
    'break case catch class const continue debugger default delete do else enum export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'yield let static implements interface package private protected public await arguments eval undefined'
  ).split(' '),
);

type Builder = { fn: string; config?: string; /** SQL type through the `sqlType` helper */ custom?: string };

/** `12,2` → `{ precision: 12, scale: 2 }` */
const precision = (args: string | undefined, scale = true) => {
  const [p, s] = (args ?? '').split(',');
  if (!p) return undefined;
  return `{ precision: ${p}${scale && s ? `, scale: ${s}` : ''} }`;
};

/** The SQL type as written, without MySQL's `auto_increment` */
const rawType = (raw: string) => raw.replace(/\s+auto_?increment\b/i, '').trim();

function builder(raw: string, info: SqlTypeInfo, dialect: SqlDialect): Builder {
  const length = info.args && /^\d+$/.test(info.args) ? `{ length: ${info.args} }` : undefined;
  const bigint = (fn: string) => ({ fn, config: "{ mode: 'number' }" });
  if (dialect === 'postgresql') {
    const auto = info.autoIncrement;
    switch (info.family) {
      case 'uuid':
        return { fn: 'uuid' };
      case 'int8':
      case 'int16':
        return { fn: auto ? 'smallserial' : 'smallint' };
      case 'int32':
        return { fn: auto ? 'serial' : 'integer' };
      case 'int64':
        return bigint(auto ? 'bigserial' : 'bigint');
      case 'bool':
        return { fn: 'boolean' };
      case 'text':
        return { fn: 'text' };
      case 'varchar':
        return { fn: 'varchar', config: length };
      case 'char':
        return { fn: 'char', config: length };
      case 'decimal':
        return { fn: 'numeric', config: precision(info.args) };
      case 'real':
        return { fn: 'real' };
      case 'double':
        return { fn: 'doublePrecision' };
      case 'date':
        return { fn: 'date' };
      case 'time':
        return { fn: 'time', config: precision(info.args, false) };
      case 'timestamp':
        return { fn: 'timestamp', config: precision(info.args, false) };
      case 'timestamptz':
        return { fn: 'timestamp', config: `{ withTimezone: true${info.args ? `, precision: ${info.args}` : ''} }` };
      case 'json':
        return { fn: 'json' };
      case 'jsonb':
        return { fn: 'jsonb' };
      default: {
        const base = rawType(raw).replace(/\[\]$/, '').toLowerCase();
        return PG_EXTRA.has(base) ? { fn: base } : { fn: 'sqlType', custom: rawType(raw).replace(/(\[\])+$/, '') };
      }
    }
  }
  if (dialect === 'sqlite') {
    switch (info.family) {
      case 'int8':
      case 'int16':
      case 'int32':
      case 'int64':
        return { fn: 'integer' };
      case 'bool':
        return { fn: 'integer', config: "{ mode: 'boolean' }" };
      case 'decimal':
        return { fn: 'numeric' };
      case 'real':
      case 'double':
        return { fn: 'real' };
      case 'blob':
        return { fn: 'blob' };
      case 'json':
      case 'jsonb':
        return { fn: 'text', config: "{ mode: 'json' }" };
      case undefined:
        return { fn: 'sqlType', custom: rawType(raw) };
      default:
        return { fn: 'text' };
    }
  }
  switch (info.family) {
    case 'int8':
      return { fn: 'tinyint' };
    case 'int16':
      return { fn: 'smallint' };
    case 'int32':
      return { fn: 'int' };
    case 'int64':
      return bigint('bigint');
    case 'bool':
      return { fn: 'boolean' };
    case 'text':
      return { fn: 'text' };
    case 'varchar':
      return { fn: 'varchar', config: length ?? '{ length: 255 }' };
    case 'char':
      return { fn: 'char', config: length };
    case 'decimal':
      return { fn: 'decimal', config: precision(info.args) };
    case 'real':
      return { fn: 'float' };
    case 'double':
      return { fn: 'double' };
    case 'date':
      return { fn: 'date' };
    case 'time':
      return { fn: 'time' };
    case 'timestamp':
      return { fn: 'datetime' };
    case 'timestamptz':
      return { fn: 'timestamp' };
    case 'json':
    case 'jsonb':
      return { fn: 'json' };
    default:
      // MariaDB's uuid, blobs and anything else keep their SQL type
      return { fn: 'sqlType', custom: rawType(raw) };
  }
}

/** A column default: plain values where drizzle's type takes them, otherwise SQL as written */
function defaultValue(value: string, info: SqlTypeInfo, dialect: SqlDialect, imports: Set<string>): string {
  const v = value.trim();
  const quoted = v.match(/^'((?:[^']|'')*)'$/);
  if (quoted) return str(quoted[1]!.replaceAll("''", "'"));
  const isNumber = /^-?\d+(\.\d+)?$/.test(v);
  const numeric = ['int8', 'int16', 'int32', 'int64', 'real', 'double'].includes(info.family ?? '');
  if (info.family === 'bool' && /^(true|false)$/i.test(v)) return v.toLowerCase();
  if (info.family === 'bool' && dialect === 'sqlite' && /^[01]$/.test(v)) return v === '1' ? 'true' : 'false';
  if (isNumber && numeric) return v;
  imports.add('sql');
  return `sql\`${v.replace(/[\\`]|\$\{/g, (c) => `\\${c}`)}\``;
}

type TableDecl = { table: TableNode; name: string; keys: Map<string, string>; used: Set<string> };

function tableDecl(
  decl: TableDecl,
  decls: Map<string, TableDecl>,
  order: Map<string, number>,
  fks: ResolvedFk[],
  dialect: SqlDialect,
  im: { core: Set<string>; orm: Set<string> },
  schemas: Map<string, string>,
  options: CodegenOptions,
): string {
  const { table } = decl;
  const core = CORE[dialect];
  const pk = table.data.columns.filter((c) => c.primaryKey);
  const columns = table.data.columns.flatMap((c) => {
    const key = decl.keys.get(c.id)!;
    const info = sqlTypeInfo(c.type, dialect);
    const b = builder(c.type, info, dialect);
    if (b.fn !== 'sqlType') im.core.add(b.fn);
    const args = [...(key !== c.name ? [str(c.name)] : []), ...(b.config ? [b.config] : [])];
    const call = b.custom ? `sqlType(${str(b.custom)})(${args.join(', ')})` : `${b.fn}(${args.join(', ')})`;

    const chain = [call];
    if (info.array && dialect === 'postgresql') chain.push('array()');
    if (c.primaryKey && pk.length === 1) {
      // SQLite counts up a lone integer key itself; AUTOINCREMENT only stops ids being reused
      chain.push(dialect === 'sqlite' && info.autoIncrement ? 'primaryKey({ autoIncrement: true })' : 'primaryKey()');
    }
    if (info.autoIncrement && (dialect === 'mysql' || dialect === 'mariadb')) chain.push('autoincrement()');
    if (!c.nullable && !(c.primaryKey && pk.length === 1)) chain.push('notNull()');
    if (c.unique && !c.primaryKey) chain.push('unique()');
    if (c.default) chain.push(`default(${defaultValue(c.default, info, dialect, im.orm)})`);
    const ref = fks.find((fk) => fk.source.id === table.id && fk.from.id === c.id);
    if (ref) {
      const target = decls.get(ref.target.id)!;
      // A table defined later (or this one) needs the column type spelled out
      const later = order.get(ref.target.id)! >= order.get(table.id)!;
      if (later) im.core.add(core.anyColumn);
      const onDelete = ref.edge.data.onDelete === 'no action' ? '' : `, { onDelete: ${str(ref.edge.data.onDelete)} }`;
      chain.push(`references(()${later ? `: ${core.anyColumn}` : ''} => ${target.name}.${target.keys.get(ref.to.id)!}${onDelete})`);
    }
    return [...jsDoc(c.note?.trim() ? [c.note] : [], '  '), `  ${key}: ${chain.join('.')},`];
  });

  const extras = [
    ...(pk.length > 1 ? [`primaryKey({ columns: [${pk.map((c) => `t.${decl.keys.get(c.id)!}`).join(', ')}] })`] : []),
    ...table.data.indexes.flatMap((ix) => {
      const keys = ix.columnIds.flatMap((id) => decl.keys.get(id) ?? []);
      if (keys.length === 0) return [];
      const fn = ix.unique ? 'uniqueIndex' : 'index';
      im.core.add(fn);
      return [`${fn}(${str(indexName(ix, table))}).on(${keys.map((k) => `t.${k}`).join(', ')})`];
    }),
  ];
  if (pk.length > 1) im.core.add('primaryKey');

  const schemaConst = usesSchema(table, dialect) ? schemas.get(table.data.schema)! : undefined;
  const define = schemaConst ? `${schemaConst}.table` : core.table;
  if (!schemaConst) im.core.add(core.table);
  const body = columns.length ? `{\n${columns.join('\n')}\n}` : '{}';
  const extra = extras.length ? `,\n  (t) => [\n${extras.map((e) => `    ${e},`).join('\n')}\n  ],\n` : '';
  const call = extra ? `${define}(\n  ${str(tableName(table, dialect))},\n  ${body.replaceAll('\n', '\n  ')}${extra})` : `${define}(${str(tableName(table, dialect))}, ${body})`;

  const role = options.roles?.get(`node:${table.id}`);
  return [
    ...(options.featureName ? [`// ${roleText(role, options.featureName)}`] : []),
    ...jsDoc(table.notes?.trim() ? [table.notes] : [], ''),
    `export const ${decl.name} = ${call};`,
  ].join('\n');
}

/** `relations()` per table: `one()` on the referencing side, `many()` (or `one()` for 1:1) on the other */
function relationDecls(decls: Map<string, TableDecl>, fks: ResolvedFk[], names: Set<string>): string[] {
  const entries = new Map<string, { helpers: Set<string>; lines: string[] }>();
  const entry = (id: string) => entries.get(id) ?? entries.set(id, { helpers: new Set(), lines: [] }).get(id)!;
  for (const rel of fkRelations(fks, (t) => entityName(t.label))) {
    const { fk } = rel;
    const s = decls.get(fk.source.id)!;
    const t = decls.get(fk.target.id)!;
    const forward = uniqueName(toCamel(rel.forward), s.used);
    const inverse = uniqueName(toCamel(rel.inverse), t.used);
    // Two relations between the same tables (or a table and itself) are paired by name
    const name = rel.ambiguous || rel.self ? `, relationName: ${str(`${s.name}_${forward}`)}` : '';
    const fields = `fields: [${s.name}.${s.keys.get(fk.from.id)!}], references: [${t.name}.${t.keys.get(fk.to.id)!}]`;
    entry(s.table.id).helpers.add('one');
    entry(s.table.id).lines.push(`  ${forward}: one(${t.name}, { ${fields}${name} }),`);
    const back = rel.oneToOne ? 'one' : 'many';
    entry(t.table.id).helpers.add(back);
    entry(t.table.id).lines.push(`  ${inverse}: ${back}(${s.name}${name ? `, { ${name.slice(2)} }` : ''}),`);
  }
  return [...decls.values()].flatMap((d) => {
    const e = entries.get(d.table.id);
    if (!e) return [];
    const helpers = [...e.helpers].sort().join(', ');
    return [`export const ${uniqueName(`${d.name}Relations`, names)} = relations(${d.name}, ({ ${helpers} }) => ({\n${e.lines.join('\n')}\n}));`];
  });
}

/** The doc's tables as a Drizzle ORM schema module */
export function toDrizzle(doc: DocTables, options: CodegenOptions = {}): string {
  const dialect = doc.database?.dialect ?? 'postgresql';
  const tables = doc.nodes.filter((n): n is TableNode => n.type === 'table');
  const im = { core: new Set<string>(), orm: new Set<string>() };

  const names = new Set(RESERVED);
  const schemas = new Map<string, string>();
  for (const t of tables) {
    if (usesSchema(t, dialect) && !schemas.has(t.data.schema))
      schemas.set(t.data.schema, uniqueName(`${toCamel(t.data.schema) || 'schema'}Schema`, names));
  }
  const decls = new Map<string, TableDecl>();
  for (const table of tables) {
    let base = toCamel(table.label) || 'table';
    if (/^\d/.test(base)) base = `t${base}`;
    // The same table name in two schemas: the schema tells them apart
    if (names.has(base)) base = `${toCamel(table.data.schema)}${toPascal(table.label)}`;
    const used = new Set<string>();
    const keys = new Map(
      table.data.columns.map((c: Column) => {
        let key = toCamel(c.name) || 'column';
        if (/^\d/.test(key)) key = `c${key}`;
        return [c.id, uniqueName(key, used)];
      }),
    );
    decls.set(table.id, { table, name: uniqueName(base, names), keys, used });
  }
  const order = new Map(tables.map((t, i) => [t.id, i]));
  const fks = resolveForeignKeys(doc);

  const body = tables.map((t) => tableDecl(decls.get(t.id)!, decls, order, fks, dialect, im, schemas, options));
  const relations = relationDecls(decls, fks, names);
  if (relations.length) im.orm.add('relations');
  if (schemas.size) im.core.add('pgSchema');
  const custom = body.some((b) => b.includes('sqlType('));
  if (custom) im.core.add('customType');

  const core = CORE[dialect];
  const imports = [
    ...(im.orm.size ? [`import { ${[...im.orm].sort().join(', ')} } from 'drizzle-orm';`] : []),
    // Column types are types only
    ...(im.core.size
      ? [`import { ${[...im.core].sort().map((n) => (n === core.anyColumn ? `type ${n}` : n)).join(', ')} } from '${core.module}';`]
      : []),
  ].join('\n');
  const header = [
    `// Generated by RuneArch: Drizzle ORM schema for ${DIALECTS[dialect].label}${options.featureName ? `, feature ${options.featureName}` : ''}.`,
    '// Requires drizzle-orm>=0.36. Create the tables with drizzle-kit; query with drizzle(client, { schema }).',
  ].join('\n');
  const helpers = [
    ...(custom
      ? ['/** SQL types drizzle has no builder for, kept as written */\nconst sqlType = (type: string) => customType<{ data: string }>({ dataType: () => type });']
      : []),
    ...[...schemas].map(([schema, name]) => `export const ${name} = pgSchema(${str(schema)});`),
  ];
  return `${[header, imports, ...helpers, ...body, ...relations].filter(Boolean).join('\n\n')}\n`;
}
