import type { CanvasDoc, Column, ForeignKeyEdge, TableNode } from './canvas';
import { DIALECTS, type SqlDialect } from './database';
import { featureById } from './feature';
import { diffNode, type DiffEntry } from './feature-diff';
import { columnSql, createIndexSql, foreignKeyClause, indexName, sqlIdent, sqlTableName, tableToDdl } from './sql';

/*
 * A feature's database changes as a migration script, up and down, in the project dialect (or
 * another one): new tables, changed columns and indexes, added and dropped foreign keys, removed
 * tables. SQLite can't alter columns or add foreign keys in place, so a table that needs that is
 * rebuilt (create, copy, drop, rename). Constraint names follow PostgreSQL's defaults
 * (`<table>_<column>_fkey`, `<table>_<column>_key`), which is what the schema export creates.
 */

export type MigrationOptions = { dialect?: SqlDialect };

export type Migration = { up: string; down: string };

/** One change: the statements that apply it, and those that undo it */
type Step = { up: string[]; down: string[] };

/** `before`: the doc without the foreign keys the feature adds, for rendering baselines */
type Ctx = { doc: CanvasDoc; before: CanvasDoc; dialect: SqlDialect; featureName: string };

const tableNodes = (doc: CanvasDoc) => new Map(doc.nodes.flatMap((n) => (n.type === 'table' ? [[n.id, n] as const] : [])));

const fkName = (table: TableNode, column: Column) => `${table.label}_${column.name}_fkey`;
const uniqueName = (table: TableNode, column: Column, dialect: SqlDialect) =>
  dialect === 'mysql' || dialect === 'mariadb' ? column.name : `${table.label}_${column.name}_key`;

const isMySql = (d: SqlDialect) => d === 'mysql' || d === 'mariadb';

function addForeignKey(ctx: Ctx, edge: ForeignKeyEdge, doc: CanvasDoc): string | null {
  const table = tableNodes(doc).get(edge.source);
  const column = table?.data.columns.find((c) => c.id === edge.data.sourceColumnId);
  const clause = table && foreignKeyClause(edge, table, doc, ctx.dialect);
  if (!table || !column || !clause) return null;
  return `ALTER TABLE ${sqlTableName(table, ctx.dialect)} ADD CONSTRAINT ${sqlIdent(fkName(table, column), ctx.dialect)} ${clause};`;
}

function dropForeignKey(ctx: Ctx, edge: ForeignKeyEdge, doc: CanvasDoc): string | null {
  const table = tableNodes(doc).get(edge.source);
  const column = table?.data.columns.find((c) => c.id === edge.data.sourceColumnId);
  if (!table || !column) return null;
  const name = sqlIdent(fkName(table, column), ctx.dialect);
  return `ALTER TABLE ${sqlTableName(table, ctx.dialect)} ${isMySql(ctx.dialect) ? 'DROP FOREIGN KEY' : 'DROP CONSTRAINT'} ${name};`;
}

const dropIndex = (ctx: Ctx, ix: TableNode['data']['indexes'][number], table: TableNode) => {
  const name = sqlIdent(indexName(ix, table), ctx.dialect);
  if (isMySql(ctx.dialect)) return `DROP INDEX ${name} ON ${sqlTableName(table, ctx.dialect)};`;
  const schema = ctx.dialect === 'postgresql' && table.data.schema !== 'public' ? `${sqlIdent(table.data.schema, ctx.dialect)}.` : '';
  return `DROP INDEX ${schema}${name};`;
};

/** The doc with one table swapped for another version of it (for rendering a baseline) */
const withTable = (doc: CanvasDoc, table: TableNode): CanvasDoc => ({
  ...doc,
  nodes: doc.nodes.map((n) => (n.id === table.id ? table : n)),
});

/** Renames (and, in PostgreSQL, moves between schemas) a table */
function renameTable(ctx: Ctx, from: TableNode, to: TableNode): string[] {
  const { dialect } = ctx;
  if (sqlTableName(from, dialect) === sqlTableName(to, dialect)) return [];
  if (dialect === 'postgresql') {
    const out: string[] = [];
    let current = from;
    if (from.data.schema !== to.data.schema) {
      out.push(`ALTER TABLE ${sqlTableName(current, dialect)} SET SCHEMA ${sqlIdent(to.data.schema, dialect)};`);
      current = { ...current, data: { ...current.data, schema: to.data.schema } };
    }
    if (from.label !== to.label) out.push(`ALTER TABLE ${sqlTableName(current, dialect)} RENAME TO ${sqlIdent(to.label, dialect)};`);
    return out;
  }
  if (isMySql(dialect)) return [`RENAME TABLE ${sqlTableName(from, dialect)} TO ${sqlTableName(to, dialect)};`];
  return [`ALTER TABLE ${sqlTableName(from, dialect)} RENAME TO ${sqlTableName(to, dialect)};`];
}

/** Statements that turn column `a` into `b` on `table` (already renamed), outside SQLite */
function alterColumn(ctx: Ctx, table: TableNode, doc: CanvasDoc, a: Column, b: Column): string[] {
  const { dialect } = ctx;
  const t = sqlTableName(table, dialect);
  const out: string[] = [];
  if (a.name !== b.name) out.push(`ALTER TABLE ${t} RENAME COLUMN ${sqlIdent(a.name, dialect)} TO ${sqlIdent(b.name, dialect)};`);
  const col = sqlIdent(b.name, dialect);
  if (isMySql(dialect)) {
    if (a.type !== b.type || a.nullable !== b.nullable || (a.default ?? '') !== (b.default ?? ''))
      out.push(`ALTER TABLE ${t} MODIFY COLUMN ${columnSql({ ...b, unique: false }, table, doc, { dialect, inlinePrimaryKey: false }).sql};`);
  } else {
    if (a.type !== b.type) {
      const type = columnSql(b, table, doc, { dialect }).sql.split(' ')[1]!;
      out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} TYPE ${type} USING ${col}::${type};`);
    }
    if (a.nullable !== b.nullable && !b.primaryKey) out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} ${b.nullable ? 'DROP' : 'SET'} NOT NULL;`);
    if ((a.default ?? '') !== (b.default ?? '')) {
      const def = columnSql(b, table, doc, { dialect }).sql.match(/ DEFAULT (.*)$/)?.[1];
      out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} ${def ? `SET DEFAULT ${def}` : 'DROP DEFAULT'};`);
    }
  }
  if (a.unique !== b.unique && !b.primaryKey) {
    const name = sqlIdent(uniqueName(table, b, dialect), dialect);
    if (b.unique) out.push(isMySql(dialect) ? `ALTER TABLE ${t} ADD UNIQUE INDEX ${name} (${col});` : `ALTER TABLE ${t} ADD CONSTRAINT ${name} UNIQUE (${col});`);
    else out.push(isMySql(dialect) ? `ALTER TABLE ${t} DROP INDEX ${name};` : `ALTER TABLE ${t} DROP CONSTRAINT ${name};`);
  }
  if (a.primaryKey !== b.primaryKey) out.push(`-- Review: the primary key of ${table.label} changes (${b.name}); not migrated automatically`);
  return out;
}

const backfillNote = (table: TableNode, c: Column) =>
  !c.nullable && !c.default && !c.primaryKey ? [`-- Backfill: existing rows of ${table.label} need a value for ${c.name} (NOT NULL without a default)`] : [];

/** SQLite: rebuild `table` from `from` to `to` (copying the columns both have, by id) */
function rebuild(ctx: Ctx, from: TableNode, toDoc: CanvasDoc, to: TableNode): string[] {
  const { dialect } = ctx;
  const temp: TableNode = { ...to, label: `${to.label}__new` };
  const create = tableToDdl(temp, withTable(toDoc, temp), { dialect }).split('\n\n')[0]!;
  const old = new Map(from.data.columns.map((c) => [c.id, c]));
  const shared = to.data.columns.filter((c) => old.has(c.id));
  const into = shared.map((c) => sqlIdent(c.name, dialect)).join(', ');
  const select = shared.map((c) => sqlIdent(old.get(c.id)!.name, dialect)).join(', ');
  return [
    `-- SQLite can't alter columns or add foreign keys in place: rebuild ${to.label}`,
    create,
    ...(shared.length ? [`INSERT INTO ${sqlTableName(temp, dialect)} (${into}) SELECT ${select} FROM ${sqlTableName(from, dialect)};`] : []),
    `DROP TABLE ${sqlTableName(from, dialect)};`,
    `ALTER TABLE ${sqlTableName(temp, dialect)} RENAME TO ${sqlTableName(to, dialect)};`,
    ...to.data.indexes.flatMap((ix) => createIndexSql(ix, to, dialect) ?? []),
  ];
}

/** SQLite adds a column in place only when it is nullable or has a default, and isn't a key */
const sqliteCanAdd = (c: Column) => (c.nullable || !!c.default) && !c.primaryKey && !c.unique;

/** The steps of one changed table: rename, columns, indexes (or a SQLite rebuild) */
function changedTable(ctx: Ctx, base: TableNode, current: TableNode, entries: DiffEntry[], newFks: Set<string>): Step[] {
  const { dialect, doc } = ctx;
  const baseDoc = withTable(ctx.before, base);
  const steps: Step[] = [];
  const columns = entries.filter((e) => e.type !== 'prop' && e.label === 'Column');
  const indexes = entries.filter((e) => e.type !== 'prop' && e.label === 'Index');

  if (dialect === 'sqlite') {
    const simple = columns.every((e) => e.type === 'added' && sqliteCanAdd(e.after as Column)) && !newFks.has(current.id);
    const rename = renameTable(ctx, base, current);
    if (simple) {
      const renamed = rename.length ? [{ up: rename, down: renameTable(ctx, current, base) }] : [];
      const adds = columns.map((e) => {
        const c = e.after as Column;
        return {
          up: [`ALTER TABLE ${sqlTableName(current, dialect)} ADD COLUMN ${columnSql(c, current, doc, { dialect }).sql};`],
          down: [`ALTER TABLE ${sqlTableName(current, dialect)} DROP COLUMN ${sqlIdent(c.name, dialect)};`],
        };
      });
      const ix = indexes.map((e): Step => indexStep(ctx, e, base, current));
      return [...renamed, ...adds, ...ix];
    }
    if (columns.length === 0 && indexes.length === 0 && !newFks.has(current.id))
      return rename.length ? [{ up: rename, down: renameTable(ctx, current, base) }] : [];
    return [{ up: rebuild(ctx, base, doc, current), down: rebuild(ctx, current, baseDoc, base) }];
  }

  const rename = renameTable(ctx, base, current);
  if (rename.length) steps.push({ up: rename, down: renameTable(ctx, current, base) });
  const t = sqlTableName(current, dialect);
  for (const e of columns) {
    if (e.type === 'added') {
      const c = e.after as Column;
      steps.push({
        up: [...backfillNote(current, c), `ALTER TABLE ${t} ADD COLUMN ${columnSql(c, current, doc, { dialect, inlinePrimaryKey: false }).sql};`],
        down: [`ALTER TABLE ${t} DROP COLUMN ${sqlIdent(c.name, dialect)};`],
      });
    } else if (e.type === 'removed') {
      const c = e.before as Column;
      steps.push({
        up: [`ALTER TABLE ${t} DROP COLUMN ${sqlIdent(c.name, dialect)};`],
        down: [`ALTER TABLE ${t} ADD COLUMN ${columnSql(c, base, baseDoc, { dialect, inlinePrimaryKey: false }).sql};`],
      });
    } else if (e.type === 'changed') {
      const [a, b] = [e.before as Column, e.after as Column];
      const up = alterColumn(ctx, current, doc, a, b);
      if (!b.nullable && a.nullable && !b.default) up.unshift(...backfillNote(current, b));
      steps.push({ up, down: alterColumn(ctx, current, baseDoc, b, a) });
    }
  }
  for (const e of indexes) steps.push(indexStep(ctx, e, base, current));
  return steps;
}

function indexStep(ctx: Ctx, e: DiffEntry, base: TableNode, current: TableNode): Step {
  const before = e.before as TableNode['data']['indexes'][number] | undefined;
  const after = e.after as TableNode['data']['indexes'][number] | undefined;
  const create = (ix: typeof after, t: TableNode): string[] => {
    const sql = ix && createIndexSql(ix, t, ctx.dialect);
    return sql ? [sql] : [];
  };
  const drop = (ix: typeof after, t: TableNode): string[] => (ix ? [dropIndex(ctx, ix, t)] : []);
  return {
    up: [...drop(before, current), ...create(after, current)],
    down: [...drop(after, current), ...create(before, base)],
  };
}

/**
 * The migration of one feature's database changes; null for an unknown feature. Order (up): drop
 * foreign keys the feature removes, rename and alter changed tables, create new tables, add
 * foreign keys, drop removed tables. Down undoes the steps in reverse.
 */
export function featureMigration(doc: CanvasDoc, featureId: string, { dialect = doc.database.dialect }: MigrationOptions = {}): Migration | null {
  const feature = featureById(doc, featureId);
  if (!feature) return null;
  const ctx: Ctx = { doc, before: doc, dialect, featureName: feature.name };
  const tables = tableNodes(doc);
  const role = (kind: 'node' | 'edge', id: string) => feature.items.find((i) => i.ref.kind === kind && i.ref.id === id)?.role;
  const fkEdges = doc.edges.filter((e): e is ForeignKeyEdge => e.kind === 'fk');

  const newTables = feature.items.flatMap((i) => (i.ref.kind === 'node' && i.role === 'added' && tables.has(i.ref.id) ? [tables.get(i.ref.id)!] : []));
  const newIds = new Set(newTables.map((t) => t.id));
  const removedTables = feature.items.flatMap((i) => (i.ref.kind === 'node' && i.role === 'removed' && tables.has(i.ref.id) ? [tables.get(i.ref.id)!] : []));
  // Foreign keys to add: every FK of a new table, plus FKs the feature adds (or changes) between existing tables
  const addedFks = fkEdges.filter((e) => newIds.has(e.source) || ['added', 'changed'].includes(role('edge', e.id) ?? ''));
  const droppedFks = fkEdges.filter((e) => ['removed', 'changed'].includes(role('edge', e.id) ?? '') && !newIds.has(e.source));
  const fkTables = new Set(addedFks.filter((e) => !newIds.has(e.source)).map((e) => e.source));
  const addedFkIds = new Set(addedFks.filter((e) => role('edge', e.id) === 'added').map((e) => e.id));
  ctx.before = { ...doc, edges: doc.edges.filter((e) => !addedFkIds.has(e.id)) };

  const steps: Step[] = [];
  const sqlite = dialect === 'sqlite';

  if (!sqlite)
    for (const e of droppedFks) {
      const down = role('edge', e.id) === 'removed' ? addForeignKey(ctx, e, doc) : null;
      steps.push({ up: [dropForeignKey(ctx, e, doc) ?? ''].filter(Boolean), down: down ? [down] : [] });
    }

  for (const item of feature.items) {
    if (item.ref.kind !== 'node' || item.role !== 'changed') continue;
    const current = tables.get(item.ref.id);
    const base = feature.baseline.nodes[item.ref.id];
    if (!current || base?.type !== 'table') continue;
    steps.push(...changedTable(ctx, base, current, diffNode(base, current), sqlite ? fkTables : new Set()));
  }
  // SQLite: existing tables that only gain a foreign key are rebuilt too
  if (sqlite)
    for (const id of fkTables) {
      const t = tables.get(id)!;
      if (role('node', id) === 'changed' && feature.baseline.nodes[id]) continue;
      steps.push({ up: rebuild(ctx, t, doc, t), down: rebuild(ctx, t, ctx.before, t) });
    }

  for (const t of newTables)
    steps.push({
      up: [tableToDdl(t, doc, { dialect, inlineForeignKeys: sqlite })],
      down: [`DROP TABLE ${sqlTableName(t, dialect)};`],
    });

  if (!sqlite)
    for (const e of addedFks) {
      const up = addForeignKey(ctx, e, doc);
      if (up) steps.push({ up: [up], down: [dropForeignKey(ctx, e, doc)!] });
    }

  for (const t of removedTables)
    steps.push({
      up: [`DROP TABLE ${sqlTableName(t, dialect)};`],
      down: [tableToDdl(t, doc, { dialect, inlineForeignKeys: sqlite }), ...(sqlite ? [] : fkEdges.filter((e) => e.source === t.id).flatMap((e) => addForeignKey(ctx, e, doc) ?? []))],
    });

  const { label, minVersion } = DIALECTS[dialect];
  const header = (direction: string) =>
    [`-- ${feature.name}: migration ${direction}. Generated by RuneArch for ${label} ${minVersion}+`, ...(sqlite ? ['PRAGMA foreign_keys = OFF;'] : [])].join('\n');
  const footer = sqlite ? ['PRAGMA foreign_keys = ON;'] : [];
  const render = (direction: string, statements: string[]) =>
    `${[header(direction), ...(statements.length ? statements : ['-- No database changes']), ...footer].join('\n\n')}\n`;
  return {
    up: render('up', steps.flatMap((s) => s.up)),
    down: render('down', [...steps].reverse().flatMap((s) => s.down)),
  };
}
