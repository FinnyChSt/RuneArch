import { toPascal } from '../api';
import type { CanvasDoc, Column, TableNode } from '../canvas';
import { DIALECTS, type DatabaseSettings, type SqlDialect } from '../database';
import { roleText } from '../feature-scope';
import { resolveForeignKeys, type ResolvedFk } from '../schema-export';
import { indexName } from '../sql';
import { sqlTypeInfo } from '../sql-types';
import type { CodegenOptions } from './options';
import { entityName, fkRelations, tableName, usesSchema } from './tables';
import { ImportSet, importBlock, pyAttr, pyClass, pyComment, pyDocstring, pyString, uniqueName } from './python';

/* ============================================================
 * SQLAlchemy 2.0 declarative ORM models from the tables: typed `Mapped[...]` columns, foreign
 * keys, indexes and a relationship pair per foreign key. Column types are read in the
 * project's dialect; tables are named like the SQL export names them (schema prefix outside PostgreSQL).
 * ============================================================ */

type DocTables = Pick<CanvasDoc, 'nodes' | 'edges'> & { database?: DatabaseSettings };

/** Every name the module may import; attributes and classes must not shadow them */
const IMPORTED = new Set(
  (
    'annotations Any UUID Decimal date datetime time str int float bool bytes list ' +
    'ARRAY BigInteger Boolean CHAR Date DateTime Double Float ForeignKey Index Integer JSON LargeBinary Numeric ' +
    'SmallInteger String Text Time Uuid text JSONB DeclarativeBase Mapped mapped_column relationship Base'
  ).split(' '),
);

/** DeclarativeBase members a column must not shadow */
const RESERVED_ATTRS = new Set([...IMPORTED, 'metadata', 'registry']);

export type Imports = { stdlib: ImportSet; sqlalchemy: ImportSet };

export type MappedType = { sa: string; py: string; note?: string };

/** `numeric(12, 2)` args → `12, 2` */
const typeArgs = (args: string | undefined) => (args ? args.split(',').join(', ') : '');

/** A column's SQLAlchemy type and Python type, adding their imports (shared with SQLModel) */
export function mappedType(raw: string, dialect: SqlDialect, im: Imports): MappedType {
  const info = sqlTypeInfo(raw, dialect);
  const sa = (name: string, args = '') => {
    im.sqlalchemy.add('sqlalchemy', name);
    return args ? `${name}(${args})` : name;
  };
  const std = (module: string, name: string) => {
    im.stdlib.add(module, name);
    return name;
  };

  const scalar = ((): MappedType => {
    switch (info.family) {
      case 'uuid':
        return { sa: sa('Uuid'), py: std('uuid', 'UUID') };
      case 'int8':
      case 'int16':
        return { sa: sa('SmallInteger'), py: 'int' };
      case 'int32':
        return { sa: sa('Integer'), py: 'int' };
      case 'int64':
        return { sa: sa('BigInteger'), py: 'int' };
      case 'bool':
        return { sa: sa('Boolean'), py: 'bool' };
      case 'text':
        return { sa: sa('Text'), py: 'str' };
      case 'varchar':
        return { sa: sa('String', typeArgs(info.args)), py: 'str' };
      case 'char':
        return { sa: sa('CHAR', typeArgs(info.args)), py: 'str' };
      case 'decimal':
        return { sa: sa('Numeric', typeArgs(info.args)), py: std('decimal', 'Decimal') };
      case 'real':
        return { sa: sa('Float'), py: 'float' };
      case 'double':
        return { sa: sa('Double'), py: 'float' };
      case 'date':
        return { sa: sa('Date'), py: std('datetime', 'date') };
      case 'time':
        return { sa: sa('Time'), py: std('datetime', 'time') };
      case 'timestamp':
        return { sa: sa('DateTime'), py: std('datetime', 'datetime') };
      case 'timestamptz':
        return { sa: sa('DateTime', 'timezone=True'), py: std('datetime', 'datetime') };
      case 'jsonb':
        if (dialect === 'postgresql') {
          im.sqlalchemy.add('sqlalchemy.dialects.postgresql', 'JSONB');
          return { sa: 'JSONB', py: std('typing', 'Any') };
        }
        return { sa: sa('JSON'), py: std('typing', 'Any') };
      case 'json':
        return { sa: sa('JSON'), py: std('typing', 'Any') };
      case 'blob':
        return { sa: sa('LargeBinary'), py: 'bytes' };
      case undefined:
        return { sa: sa('Text'), py: 'str', note: `${raw.trim()}: no SQLAlchemy type, mapped as Text` };
    }
  })();
  if (!info.array) return scalar;
  if (dialect === 'postgresql') return { ...scalar, sa: sa('ARRAY', scalar.sa), py: `list[${scalar.py}]` };
  return { sa: sa('JSON'), py: `list[${scalar.py}]`, note: `${raw.trim()}: ${DIALECTS[dialect].label} has no arrays, stored as JSON` };
}

/** A column default as `server_default`: quoted strings as Python strings, anything else as SQL text */
export function serverDefault(value: string, im: Imports): string {
  const v = value.trim();
  const quoted = v.match(/^'((?:[^']|'')*)'$/);
  if (quoted) return pyString(quoted[1]!.replaceAll("''", "'"));
  im.sqlalchemy.add('sqlalchemy', 'text');
  return `text(${pyString(v)})`;
}

type TableClass = {
  table: TableNode;
  name: string;
  /** Column id → attribute */
  attrs: Map<string, string>;
  /** Attribute names taken in the class, relationships included */
  used: Set<string>;
  relationships: string[];
};

/** `schema.table.column` for `ForeignKey(...)` */
export const columnRef = (t: TableNode, c: Column, dialect: SqlDialect) =>
  `${usesSchema(t, dialect) ? `${t.data.schema}.` : ''}${tableName(t, dialect)}.${c.name}`;

/** A relationship on each side of every foreign key */
function addRelationships(classes: Map<string, TableClass>, fks: ResolvedFk[]) {
  for (const rel of fkRelations(fks, (t) => classes.get(t.id)!.name)) {
    const { fk } = rel;
    const s = classes.get(fk.source.id)!;
    const t = classes.get(fk.target.id)!;
    const fromAttr = s.attrs.get(fk.from.id)!;
    const toAttr = t.attrs.get(fk.to.id)!;
    const forward = uniqueName(pyAttr(rel.forward, RESERVED_ATTRS), s.used);
    const inverse = uniqueName(pyAttr(rel.inverse, RESERVED_ATTRS), t.used);

    const keys = rel.ambiguous ? [`foreign_keys=${pyString(`${s.name}.${fromAttr}`)}`] : [];
    const forwardArgs = [
      `back_populates=${pyString(inverse)}`,
      ...keys,
      // Self-reference: the referenced row is the "one" side
      ...(rel.self ? [`remote_side=${pyString(`${t.name}.${toAttr}`)}`] : []),
    ];
    const inverseArgs = [
      `back_populates=${pyString(forward)}`,
      ...keys,
      // Let the database cascade instead of loading the rows first
      ...(fk.edge.data.onDelete === 'cascade' ? ['passive_deletes=True'] : []),
    ];
    const nullable = fk.from.nullable && !fk.from.primaryKey;
    s.relationships.push(`    ${forward}: Mapped[${t.name}${nullable ? ' | None' : ''}] = relationship(${forwardArgs.join(', ')})`);
    t.relationships.push(
      `    ${inverse}: Mapped[${rel.oneToOne ? `${s.name} | None` : `list[${s.name}]`}] = relationship(${inverseArgs.join(', ')})`,
    );
  }
}

/** `__table_args__` lines: indexes, then the schema (PostgreSQL); shared with SQLModel */
export function tableArgs(table: TableNode, dialect: SqlDialect, im: Imports): string[] {
  const indexes = [
    ...table.data.indexes.flatMap((ix) => {
      // Index columns are named as in the table, not by attribute
      const names = ix.columnIds.flatMap((id) => table.data.columns.find((c) => c.id === id)?.name ?? []);
      if (names.length === 0) return [];
      im.sqlalchemy.add('sqlalchemy', 'Index');
      return [`Index(${[indexName(ix, table), ...names].map(pyString).join(', ')}${ix.unique ? ', unique=True' : ''})`];
    }),
  ];
  const schemaArg = usesSchema(table, dialect) ? `{"schema": ${pyString(table.data.schema)}}` : undefined;
  return indexes.length
    ? [`    __table_args__ = (`, ...[...indexes, ...(schemaArg ? [schemaArg] : [])].map((a) => `        ${a},`), '    )']
    : schemaArg
      ? [`    __table_args__ = ${schemaArg}`]
      : [];
}

function tableClass(cls: TableClass, fks: ResolvedFk[], dialect: SqlDialect, im: Imports, options: CodegenOptions): string {
  const { table } = cls;
  const pkCount = table.data.columns.filter((c) => c.primaryKey).length;

  const columns = table.data.columns.flatMap((c) => {
    const attr = cls.attrs.get(c.id)!;
    const type = mappedType(c.type, dialect, im);
    const info = sqlTypeInfo(c.type, dialect);
    const integer = info.family === 'int8' || info.family === 'int16' || info.family === 'int32' || info.family === 'int64';
    const refs = fks.filter((fk) => fk.source.id === table.id && fk.from.id === c.id);
    if (refs.length) im.sqlalchemy.add('sqlalchemy', 'ForeignKey');

    const args = [
      ...(attr !== c.name ? [pyString(c.name)] : []),
      type.sa,
      ...refs.map((fk) => {
        const onDelete = fk.edge.data.onDelete === 'no action' ? '' : `, ondelete=${pyString(fk.edge.data.onDelete.toUpperCase())}`;
        return `ForeignKey(${pyString(columnRef(fk.target, fk.to, dialect))}${onDelete})`;
      }),
      ...(c.primaryKey ? ['primary_key=True'] : []),
      // SQLAlchemy auto-increments a lone integer key unless told otherwise (SQLite always does)
      ...(c.primaryKey && pkCount === 1 && integer && !info.autoIncrement && dialect !== 'sqlite' ? ['autoincrement=False'] : []),
      ...(info.autoIncrement && !(c.primaryKey && pkCount === 1) ? ['autoincrement=True'] : []),
      ...(c.unique && !c.primaryKey ? ['unique=True'] : []),
      ...(c.default ? [`server_default=${serverDefault(c.default, im)}`] : []),
      ...(c.note?.trim() ? [`comment=${pyString(c.note.trim())}`] : []),
    ];
    const nullable = c.nullable && !c.primaryKey;
    return [
      ...(type.note ? pyComment(type.note, '    ') : []),
      `    ${attr}: Mapped[${type.py}${nullable ? ' | None' : ''}] = mapped_column(${args.join(', ')})`,
    ];
  });

  const argsLine = tableArgs(table, dialect, im);

  const role = options.roles?.get(`node:${table.id}`);
  return [
    ...(options.featureName ? pyComment(roleText(role, options.featureName)) : []),
    `class ${cls.name}(Base):`,
    ...(table.notes?.trim() ? [...pyDocstring(table.notes, '    '), ''] : []),
    `    __tablename__ = ${pyString(tableName(table, dialect))}`,
    ...argsLine,
    ...(columns.length ? ['', ...columns] : []),
    ...(cls.relationships.length ? ['', ...cls.relationships] : []),
  ].join('\n');
}

/** The doc's tables as SQLAlchemy 2.0 ORM classes (Python 3.10+) */
export function toSqlAlchemy(doc: DocTables, options: CodegenOptions = {}): string {
  const dialect = doc.database?.dialect ?? 'postgresql';
  const tables = doc.nodes.filter((n): n is TableNode => n.type === 'table');
  const im: Imports = { stdlib: new ImportSet(), sqlalchemy: new ImportSet() };
  im.sqlalchemy.add('sqlalchemy.orm', 'DeclarativeBase', 'Mapped', 'mapped_column');

  const classNames = new Set<string>();
  const classes = new Map(
    tables.map((table) => {
      let base = pyClass(entityName(table.label), IMPORTED);
      // The same table name in two schemas: the schema tells them apart
      if (classNames.has(base)) base = `${toPascal(table.data.schema)}${base}`;
      const used = new Set<string>();
      const attrs = new Map(table.data.columns.map((c) => [c.id, uniqueName(pyAttr(c.name, RESERVED_ATTRS), used)]));
      return [table.id, { table, name: uniqueName(base, classNames), attrs, used, relationships: [] } satisfies TableClass];
    }),
  );
  const fks = resolveForeignKeys(doc);
  addRelationships(classes, fks);
  if (fks.length) im.sqlalchemy.add('sqlalchemy.orm', 'relationship');

  const body = [...classes.values()].map((cls) => tableClass(cls, fks, dialect, im, options));
  const { label } = DIALECTS[dialect];
  const header = [
    `# Generated by RuneArch: SQLAlchemy 2.0 ORM models for ${label}${options.featureName ? `, feature ${options.featureName}` : ''}.`,
    '# Requires Python 3.10+ and SQLAlchemy>=2.0.',
  ].join('\n');
  // Postponed annotations let classes refer to classes defined further down
  const top = [header, 'from __future__ import annotations', ...importBlock(im.stdlib, im.sqlalchemy)].join('\n\n');
  const base = 'class Base(DeclarativeBase):\n    pass';
  return `${[top, base, ...body].join('\n\n\n')}\n`;
}
