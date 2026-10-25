import { toPascal } from '../api';
import type { CanvasDoc, TableNode } from '../canvas';
import { DIALECTS, type DatabaseSettings, type SqlDialect } from '../database';
import { roleText } from '../feature-scope';
import { resolveForeignKeys, type ResolvedFk } from '../schema-export';
import { sqlTypeInfo } from '../sql-types';
import type { CodegenOptions } from './options';
import { ImportSet, importBlock, pyAttr, pyClass, pyComment, pyDocstring, pyString, uniqueName } from './python';
import { columnRef, mappedType, serverDefault, tableArgs, type Imports } from './sqlalchemy';
import { entityName, fkRelations, tableName } from './tables';

/* ============================================================
 * SQLModel models from the tables: one class per table that is both the SQLAlchemy table and
 * its Pydantic model. Column types, defaults and indexes are the SQLAlchemy export's; columns
 * the database fills in (keys, server defaults) default to None so objects can be created
 * without them. A relationship pair per foreign key, quoted so classes can refer to later ones.
 * ============================================================ */

type DocTables = Pick<CanvasDoc, 'nodes' | 'edges'> & { database?: DatabaseSettings };

/** Every name the module may import, plus SQLModel and Pydantic members; attributes and classes must not shadow them */
const RESERVED = new Set(
  (
    'Any UUID Decimal date datetime time str int float bool bytes list Optional ' +
    'ARRAY BigInteger Boolean CHAR Date DateTime Double Float Index Integer JSON LargeBinary Numeric ' +
    'SmallInteger String Text Time Uuid text JSONB Field Relationship SQLModel ' +
    'metadata registry model_config copy dict json schema schema_json construct validate fields from_orm parse_obj ' +
    'parse_raw parse_file update_forward_refs'
  ).split(' '),
);

const INTEGER = new Set(['int8', 'int16', 'int32', 'int64']);

type ModelClass = { table: TableNode; name: string; attrs: Map<string, string>; used: Set<string>; relationships: string[] };

/** `{"key": value, ...}` from the entries that are set */
const pyDict = (entries: [string, string | undefined][]) => {
  const set = entries.filter(([, v]) => v !== undefined);
  return set.length ? `{${set.map(([k, v]) => `${pyString(k)}: ${v}`).join(', ')}}` : undefined;
};

function addRelationships(classes: Map<string, ModelClass>, fks: ResolvedFk[], im: Imports) {
  for (const rel of fkRelations(fks, (t) => classes.get(t.id)!.name)) {
    const { fk } = rel;
    const s = classes.get(fk.source.id)!;
    const t = classes.get(fk.target.id)!;
    const forward = uniqueName(pyAttr(rel.forward, RESERVED), s.used);
    const inverse = uniqueName(pyAttr(rel.inverse, RESERVED), t.used);

    const keys = rel.ambiguous ? pyString(`${s.name}.${s.attrs.get(fk.from.id)!}`) : undefined;
    // Self-reference: the referenced row is the "one" side
    const remote = rel.self ? pyString(`${t.name}.${t.attrs.get(fk.to.id)!}`) : undefined;
    const forwardKwargs = pyDict([
      ['foreign_keys', keys],
      ['remote_side', remote],
    ]);
    const inverseKwargs = pyDict([['foreign_keys', keys]]);
    const forwardArgs = [`back_populates=${pyString(inverse)}`, ...(forwardKwargs ? [`sa_relationship_kwargs=${forwardKwargs}`] : [])];
    const inverseArgs = [
      `back_populates=${pyString(forward)}`,
      // Let the database cascade instead of loading the rows first
      ...(fk.edge.data.onDelete === 'cascade' ? ['passive_deletes=True'] : []),
      ...(inverseKwargs ? [`sa_relationship_kwargs=${inverseKwargs}`] : []),
    ];

    im.stdlib.add('typing', 'Optional');
    s.relationships.push(`    ${forward}: Optional[${pyString(t.name)}] = Relationship(${forwardArgs.join(', ')})`);
    const back = rel.oneToOne ? `Optional[${pyString(s.name)}]` : `list[${pyString(s.name)}]`;
    t.relationships.push(`    ${inverse}: ${back} = Relationship(${inverseArgs.join(', ')})`);
  }
}

function modelClass(cls: ModelClass, fks: ResolvedFk[], dialect: SqlDialect, im: Imports, options: CodegenOptions): string {
  const { table } = cls;
  const pkCount = table.data.columns.filter((c) => c.primaryKey).length;

  const columns = table.data.columns.flatMap((c) => {
    const attr = cls.attrs.get(c.id)!;
    const type = mappedType(c.type, dialect, im);
    const info = sqlTypeInfo(c.type, dialect);
    const singlePk = c.primaryKey && pkCount === 1;
    const integerPk = singlePk && INTEGER.has(info.family ?? '');
    // SQLAlchemy counts up a lone integer key unless told otherwise (SQLite always does)
    const keepsCount = integerPk && (info.autoIncrement || dialect === 'sqlite');
    const ref = fks.find((fk) => fk.source.id === table.id && fk.from.id === c.id);

    // Values the database fills in may be left out when creating an object
    const generated = Boolean(c.default) || keepsCount;
    const optional = (c.nullable && !c.primaryKey) || generated;
    const kwargs = pyDict([
      ['name', attr !== c.name ? pyString(c.name) : undefined],
      ['server_default', c.default ? serverDefault(c.default, im) : undefined],
      ['autoincrement', integerPk && !keepsCount ? 'False' : info.autoIncrement && !singlePk ? 'True' : undefined],
      ['comment', c.note?.trim() ? pyString(c.note.trim()) : undefined],
    ]);
    const args = [
      ...(optional ? ['default=None'] : []),
      ...(c.primaryKey ? ['primary_key=True'] : []),
      `sa_type=${type.sa}`,
      ...(ref ? [`foreign_key=${pyString(columnRef(ref.target, ref.to, dialect))}`] : []),
      ...(ref && ref.edge.data.onDelete !== 'no action' ? [`ondelete=${pyString(ref.edge.data.onDelete.toUpperCase())}`] : []),
      ...(c.unique && !c.primaryKey ? ['unique=True'] : []),
      // Optional for Python only: the column itself stays NOT NULL
      ...(optional && !c.nullable && !c.primaryKey ? ['nullable=False'] : []),
      ...(kwargs ? [`sa_column_kwargs=${kwargs}`] : []),
    ];
    return [...(type.note ? pyComment(type.note, '    ') : []), `    ${attr}: ${type.py}${optional ? ' | None' : ''} = Field(${args.join(', ')})`];
  });

  const role = options.roles?.get(`node:${table.id}`);
  return [
    ...(options.featureName ? pyComment(roleText(role, options.featureName)) : []),
    `class ${cls.name}(SQLModel, table=True):`,
    ...(table.notes?.trim() ? [...pyDocstring(table.notes, '    '), ''] : []),
    `    __tablename__ = ${pyString(tableName(table, dialect))}`,
    ...tableArgs(table, dialect, im),
    ...(columns.length ? ['', ...columns] : []),
    ...(cls.relationships.length ? ['', ...cls.relationships] : []),
  ].join('\n');
}

/** The doc's tables as SQLModel classes (Python 3.10+) */
export function toSqlModel(doc: DocTables, options: CodegenOptions = {}): string {
  const dialect = doc.database?.dialect ?? 'postgresql';
  const tables = doc.nodes.filter((n): n is TableNode => n.type === 'table');
  const im: Imports = { stdlib: new ImportSet(), sqlalchemy: new ImportSet() };
  im.sqlalchemy.add('sqlmodel', 'Field', 'SQLModel');

  const classNames = new Set<string>();
  const classes = new Map(
    tables.map((table) => {
      let base = pyClass(entityName(table.label), RESERVED);
      // The same table name in two schemas: the schema tells them apart
      if (classNames.has(base)) base = `${toPascal(table.data.schema)}${base}`;
      const used = new Set<string>();
      const attrs = new Map(table.data.columns.map((c) => [c.id, uniqueName(pyAttr(c.name, RESERVED), used)]));
      return [table.id, { table, name: uniqueName(base, classNames), attrs, used, relationships: [] } satisfies ModelClass];
    }),
  );
  const fks = resolveForeignKeys(doc);
  addRelationships(classes, fks, im);
  if (fks.length) im.sqlalchemy.add('sqlmodel', 'Relationship');

  const body = [...classes.values()].map((cls) => modelClass(cls, fks, dialect, im, options));
  const header = [
    `# Generated by RuneArch: SQLModel models for ${DIALECTS[dialect].label}${options.featureName ? `, feature ${options.featureName}` : ''}.`,
    '# Requires Python 3.10+ and sqlmodel>=0.0.21. Each class is both the table and its Pydantic model.',
  ].join('\n');
  const top = [header, ...importBlock(im.stdlib, im.sqlalchemy)].join('\n\n');
  return `${[top, ...body].join('\n\n\n')}\n`;
}
