import { toCamel, toPascal } from '../api';
import type { CanvasDoc, TableNode } from '../canvas';
import { DIALECTS, type DatabaseSettings, type SqlDialect } from '../database';
import { roleText } from '../feature-scope';
import { resolveForeignKeys } from '../schema-export';
import { indexName } from '../sql';
import { sqlTypeInfo, type SqlTypeInfo } from '../sql-types';
import type { CodegenOptions } from './options';
import { uniqueName } from './python';
import { entityName, fkRelations, tableName, usesSchema } from './tables';

/* ============================================================
 * Prisma schema (Prisma 7) from the tables: a model per table with scalar types and native
 * `@db` types for the project dialect, keys, defaults, indexes, `@map`/`@@map` to the SQL names,
 * and a relation pair per foreign key. Types Prisma can't express stay as `Unsupported("...")`.
 * ============================================================ */

type DocTables = Pick<CanvasDoc, 'nodes' | 'edges'> & { database?: DatabaseSettings };

const PROVIDER: Record<SqlDialect, string> = { postgresql: 'postgresql', mysql: 'mysql', mariadb: 'mysql', sqlite: 'sqlite' };

/** Names a model can't take: Prisma's scalar types and keywords */
const RESERVED = new Set('String Boolean Int BigInt Float Decimal DateTime Json Bytes Unsupported model enum type view datasource generator'.split(' '));

const ON_DELETE = { 'no action': 'NoAction', cascade: 'Cascade', 'set null': 'SetNull', restrict: 'Restrict' } as const;

/** A Prisma string literal */
const str = (text: string) => JSON.stringify(text);

/** `///` doc comment lines */
const docLines = (text: string | undefined, indent: string) =>
  text?.trim()
    ? text
        .trim()
        .split('\n')
        .map((l) => `${indent}/// ${l.trim()}`.trimEnd())
    : [];

type Scalar = { type: string; native?: string; note?: string };

/** `numeric(12,2)` args → `12, 2` */
const args = (a: string | undefined) => (a ? a.split(',').join(', ') : '');

function scalar(raw: string, info: SqlTypeInfo, dialect: SqlDialect): Scalar {
  const unsupported = (): Scalar => ({ type: `Unsupported(${str(raw.replace(/\s+auto_?increment\b/i, '').replace(/(\[\])+$/, '').trim())})` });
  if (dialect === 'sqlite') {
    switch (info.family) {
      case 'int8':
      case 'int16':
      case 'int32':
        return { type: 'Int' };
      case 'int64':
        return { type: 'BigInt' };
      case 'bool':
        return { type: 'Boolean' };
      case 'decimal':
        return { type: 'Decimal' };
      case 'real':
      case 'double':
        return { type: 'Float' };
      case 'blob':
        return { type: 'Bytes' };
      case undefined:
        return unsupported();
      default:
        return { type: 'String' };
    }
  }
  const pg = dialect === 'postgresql';
  const precision = (fallback: string) => `(${info.args ?? fallback})`;
  switch (info.family) {
    case 'uuid':
      // MariaDB's uuid type has no Prisma equivalent
      return pg ? { type: 'String', native: 'Uuid' } : { type: 'String', native: 'Char(36)', note: `${raw.trim()}: Prisma maps it as char(36)` };
    case 'int8':
      return { type: 'Int', native: pg ? 'SmallInt' : 'TinyInt' };
    case 'int16':
      return { type: 'Int', native: 'SmallInt' };
    case 'int32':
      return { type: 'Int' };
    case 'int64':
      return { type: 'BigInt' };
    case 'bool':
      return { type: 'Boolean' };
    case 'text':
      return { type: 'String', native: pg ? undefined : 'Text' };
    case 'varchar':
      return { type: 'String', native: info.args ? `VarChar(${info.args})` : pg ? 'VarChar' : 'VarChar(255)' };
    case 'char':
      return { type: 'String', native: `Char${info.args ? `(${info.args})` : ''}` };
    case 'decimal':
      return { type: 'Decimal', native: info.args ? `Decimal(${args(info.args)})` : undefined };
    case 'real':
      return { type: 'Float', native: pg ? 'Real' : 'Float' };
    case 'double':
      return { type: 'Float' };
    case 'date':
      return { type: 'DateTime', native: 'Date' };
    case 'time':
      return { type: 'DateTime', native: `Time${precision(pg ? '6' : '0')}` };
    case 'timestamp':
      return { type: 'DateTime', native: pg ? `Timestamp${precision('6')}` : `DateTime${precision('0')}` };
    case 'timestamptz':
      return { type: 'DateTime', native: pg ? `Timestamptz${precision('6')}` : `Timestamp${precision('0')}` };
    case 'json':
      return { type: 'Json', native: pg ? 'Json' : undefined };
    case 'jsonb':
      return { type: 'Json' };
    case 'blob':
      return { type: 'Bytes' };
    default:
      return unsupported();
  }
}

const NOW = /^(now\(\)|current_timestamp(\(\))?|localtimestamp|datetime\('now'\))$/i;

/** `@default(...)`: Prisma values where they fit, otherwise the SQL expression via `dbgenerated` */
function defaultAttr(value: string, s: Scalar, dialect: SqlDialect): string {
  const v = value.trim().replace(/^\((.*)\)$/, '$1');
  const quoted = v.match(/^'((?:[^']|'')*)'$/);
  if (quoted && s.type === 'String') return `@default(${str(quoted[1]!.replaceAll("''", "'"))})`;
  if (s.type === 'Boolean' && /^(true|false)$/i.test(v)) return `@default(${v.toLowerCase()})`;
  if (s.type === 'Boolean' && dialect === 'sqlite' && /^[01]$/.test(v)) return `@default(${v === '1'})`;
  if (['Int', 'BigInt', 'Float', 'Decimal'].includes(s.type) && /^-?\d+(\.\d+)?$/.test(v)) return `@default(${v})`;
  if (s.type === 'DateTime' && NOW.test(v)) return '@default(now())';
  return `@default(dbgenerated(${str(value.trim())}))`;
}

type Model = { table: TableNode; name: string; fields: Map<string, string>; used: Set<string>; relations: string[][] };

/** Field lines padded into columns, like `prisma format` (doc comments don't break the columns) */
function aligned(rows: string[][], indent = '  '): string[] {
  const widths = [Math.max(0, ...rows.map((r) => r[0]!.length)), Math.max(0, ...rows.map((r) => r[1]!.length))];
  return rows.map((r) => {
    const [name, type, ...attrs] = r;
    if (!attrs.length) return `${indent}${name!.padEnd(widths[0]!)} ${type}`.trimEnd();
    return `${indent}${name!.padEnd(widths[0]!)} ${type!.padEnd(widths[1]!)} ${attrs.join(' ')}`.trimEnd();
  });
}

function modelBlock(model: Model, dialect: SqlDialect, schemaAttr: boolean, options: CodegenOptions): string {
  const { table } = model;
  const pk = table.data.columns.filter((c) => c.primaryKey);
  const docs = new Map<number, string[]>();
  const rows = table.data.columns.map((c, i) => {
    const field = model.fields.get(c.id)!;
    const info = sqlTypeInfo(c.type, dialect);
    const s = scalar(c.type, info, dialect);
    const list = info.array && dialect === 'postgresql';
    // Lists can't be optional in Prisma
    const optional = c.nullable && !c.primaryKey && !list;
    const attrs = [
      ...(c.primaryKey && pk.length === 1 ? ['@id'] : []),
      ...(c.unique && !c.primaryKey ? ['@unique'] : []),
      ...(info.autoIncrement ? ['@default(autoincrement())'] : c.default ? [defaultAttr(c.default, s, dialect)] : []),
      ...(field !== c.name ? [`@map(${str(c.name)})`] : []),
      ...(s.native && dialect !== 'sqlite' ? [`@db.${s.native}`] : []),
    ];
    docs.set(i, [...docLines(c.note, '  '), ...(s.note ? [`  // ${s.note}`] : [])]);
    return [field, `${s.type}${list ? '[]' : optional ? '?' : ''}`, ...attrs];
  });

  const fieldLines = aligned(rows).flatMap((line, i) => [...docs.get(i)!, line]);

  const fieldList = (ids: string[]) => ids.flatMap((id) => model.fields.get(id) ?? []).join(', ');
  const blockAttrs = [
    ...(pk.length > 1 ? [`@@id([${fieldList(pk.map((c) => c.id))}])`] : []),
    // Unique constraints before plain indexes, as `prisma format` orders them
    ...[...table.data.indexes].sort((x, y) => Number(y.unique) - Number(x.unique)).flatMap((ix) => {
      const fields = fieldList(ix.columnIds);
      return fields ? [`@@${ix.unique ? 'unique' : 'index'}([${fields}], map: ${str(indexName(ix, table))})`] : [];
    }),
    ...(model.name !== tableName(table, dialect) ? [`@@map(${str(tableName(table, dialect))})`] : []),
    ...(schemaAttr ? [`@@schema(${str(table.data.schema)})`] : []),
  ];

  const role = options.roles?.get(`node:${table.id}`);
  const sections = [fieldLines, aligned(model.relations), blockAttrs.map((a) => `  ${a}`)].filter((s) => s.length);
  return [
    ...(options.featureName ? [`// ${roleText(role, options.featureName)}`] : []),
    ...docLines(table.notes, ''),
    `model ${model.name} {`,
    sections.map((s) => s.join('\n')).join('\n\n'),
    '}',
  ].join('\n');
}

/** The doc's tables as a Prisma schema */
export function toPrisma(doc: DocTables, options: CodegenOptions = {}): string {
  const dialect = doc.database?.dialect ?? 'postgresql';
  const tables = doc.nodes.filter((n): n is TableNode => n.type === 'table');

  const names = new Set(RESERVED);
  const models = new Map<string, Model>();
  for (const table of tables) {
    let base = entityName(table.label);
    if (RESERVED.has(base)) base = `${base}_`;
    // The same table name in two schemas: the schema tells them apart
    if (names.has(base)) base = `${toPascal(table.data.schema)}${base}`;
    const used = new Set<string>();
    const fields = new Map(
      table.data.columns.map((c) => {
        let field = toCamel(c.name) || 'column';
        if (/^\d/.test(field)) field = `c${field}`;
        return [c.id, uniqueName(field, used)];
      }),
    );
    models.set(table.id, { table, name: uniqueName(base, names), fields, used, relations: [] });
  }

  for (const rel of fkRelations(resolveForeignKeys(doc), (t) => models.get(t.id)!.name)) {
    const { fk } = rel;
    const s = models.get(fk.source.id)!;
    const t = models.get(fk.target.id)!;
    const forward = uniqueName(toCamel(rel.forward), s.used);

    const name = rel.ambiguous || rel.self ? `${str(`${s.name}${toPascal(forward)}`)}, ` : '';
    const optional = fk.from.nullable && !fk.from.primaryKey;
    const onDelete = ON_DELETE[fk.edge.data.onDelete];
    s.relations.push([
      forward,
      `${t.name}${optional ? '?' : ''}`,
      `@relation(${name}fields: [${s.fields.get(fk.from.id)!}], references: [${t.fields.get(fk.to.id)!}], onDelete: ${onDelete})`,
    ]);
    // A one-to-one back side needs a unique FK column; otherwise Prisma reads it as one-to-many
    const pkCount = fk.source.data.columns.filter((c) => c.primaryKey).length;
    const unique = fk.from.unique || (fk.from.primaryKey && pkCount === 1);
    const single = rel.oneToOne && unique;
    const inverse = uniqueName(toCamel(single || !rel.oneToOne ? rel.inverse : rel.inverseMany), t.used);
    t.relations.push([inverse, single ? `${s.name}?` : `${s.name}[]`, ...(name ? [`@relation(${name.slice(0, -2)})`] : [])]);
  }

  const schemas = dialect === 'postgresql' ? [...new Set(tables.map((t) => t.data.schema))] : [];
  const multiSchema = tables.some((t) => usesSchema(t, dialect));
  const datasource = [
    'datasource db {',
    `  provider = ${str(PROVIDER[dialect])}`,
    ...(multiSchema ? [`  schemas  = [${schemas.sort().map(str).join(', ')}]`] : []),
    '}',
  ].join('\n');
  const generator = ['generator client {', '  provider = "prisma-client"', '  output   = "../generated/prisma"', '}'].join('\n');
  const header = [
    `// Generated by RuneArch: Prisma schema for ${DIALECTS[dialect].label}${options.featureName ? `, feature ${options.featureName}` : ''}.`,
    '// Prisma 7: the connection URL goes in prisma.config.ts. Prisma 6: add url = env("DATABASE_URL") to the datasource.',
  ].join('\n');

  const body = [...models.values()].map((m) => modelBlock(m, dialect, multiSchema, options));
  return `${[header, generator, datasource, ...body].join('\n\n')}\n`;
}
