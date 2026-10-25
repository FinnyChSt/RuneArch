/*
 * Database schema imports (SQL DDL, DBML) parse into this neutral model first. It names tables
 * and columns (no ids yet); the web app turns it into table nodes and FK edges and merges it into
 * the canvas. Parsers are lenient: what they can't read becomes a warning, not an error.
 */

export type OnDelete = 'no action' | 'cascade' | 'set null' | 'restrict';

export type ImportedColumn = {
  name: string;
  /** As written in the source, e.g. `varchar(255)`, `int auto_increment` */
  type: string;
  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
  /** Raw SQL expression or literal, e.g. `now()`, `'draft'`, `0` */
  default?: string;
  note?: string;
};

export type ImportedIndex = { name?: string; columns: string[]; unique: boolean };

export type ImportedTable = {
  schema: string;
  name: string;
  columns: ImportedColumn[];
  indexes: ImportedIndex[];
  note?: string;
};

/** A table reference: schema and name */
export type TableRef = { schema: string; table: string };

/** A foreign key: `from` columns reference `to` columns (`to.columns` empty = the target's primary key) */
export type ImportedRef = {
  from: TableRef & { columns: string[] };
  to: TableRef & { columns: string[] };
  onDelete: OnDelete;
  /** DBML `-` refs: one-to-one */
  oneToOne?: boolean;
};

export type ImportedSchema = {
  tables: ImportedTable[];
  refs: ImportedRef[];
  /** DBML table groups; they become frames */
  groups: { name: string; tables: TableRef[] }[];
  warnings: string[];
};

export const emptySchema = (): ImportedSchema => ({ tables: [], refs: [], groups: [], warnings: [] });

/** Table names compare case-insensitively, like unquoted SQL identifiers */
export const tableKey = (ref: TableRef) => `${ref.schema.toLowerCase()}.${ref.table.toLowerCase()}`;

export const findTable = (schema: ImportedSchema, ref: TableRef) =>
  schema.tables.find((t) => tableKey({ schema: t.schema, table: t.name }) === tableKey(ref));

export const findColumn = (table: ImportedTable | undefined, name: string) =>
  table?.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());

/** `CASCADE`, `set null`, ... → the doc's onDelete; SET DEFAULT and unknown actions fall back to no action */
export function onDeleteOf(action: string | undefined): OnDelete {
  switch (action?.trim().toLowerCase().replace(/\s+/g, ' ')) {
    case 'cascade':
      return 'cascade';
    case 'set null':
      return 'set null';
    case 'restrict':
      return 'restrict';
    default:
      return 'no action';
  }
}
