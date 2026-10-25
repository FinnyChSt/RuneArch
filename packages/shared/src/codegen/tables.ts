import { toPascal } from '../api';
import type { TableNode } from '../canvas';
import type { SqlDialect } from '../database';
import type { ResolvedFk } from '../schema-export';
import { pySnake } from './python';

/* ============================================================
 * Table naming shared by the ORM generators (SQLAlchemy, Drizzle, Prisma)
 * ============================================================ */

function singular(word: string): string {
  if (/[^aeiou]ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|x|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  if (/[^su]s$/i.test(word) && !/is$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** `orders` → `Order`, `order_items` → `OrderItem`: the table name, last word singular */
export function entityName(label: string): string {
  const words = pySnake(label).split('_').filter(Boolean);
  if (words.length) words.push(singular(words.pop()!));
  return toPascal(words.join(' ')) || 'Table';
}

/** Whether the table's schema is a real schema (PostgreSQL) rather than a name prefix */
export const usesSchema = (t: TableNode, dialect: SqlDialect) => dialect === 'postgresql' && t.data.schema !== 'public';

/** The table name SQL sees: outside PostgreSQL a schema prefixes it, like the SQL export does */
export const tableName = (t: TableNode, dialect: SqlDialect) =>
  t.data.schema === 'public' || usesSchema(t, dialect) ? t.label : `${t.data.schema}_${t.label}`;

export type FkRelation = {
  fk: ResolvedFk;
  /** On the referencing table, snake_case: the FK column without `_id`, else the referenced entity */
  forward: string;
  /** On the referenced table, snake_case: the referencing table (or entity for 1:1), prefixed by `forward` when ambiguous */
  inverse: string;
  /** `inverse` as a list, for a 1:1 an ORM has to read as one-to-many */
  inverseMany: string;
  /** More than one FK links the same two tables, so relations need explicit keys or names */
  ambiguous: boolean;
  self: boolean;
  oneToOne: boolean;
};

/** A relation pair per foreign key, named after the FK column and the other table */
export function fkRelations(fks: readonly ResolvedFk[], entityOf: (t: TableNode) => string): FkRelation[] {
  const pair = (fk: ResolvedFk) => [fk.source.id, fk.target.id].sort().join('|');
  const between = new Map<string, number>();
  for (const fk of fks) between.set(pair(fk), (between.get(pair(fk)) ?? 0) + 1);

  return fks.map((fk) => {
    const oneToOne = fk.edge.data.cardinality === '1:1';
    const column = pySnake(fk.from.name);
    const forward = /.._id$/.test(column) ? column.slice(0, -3) : pySnake(entityOf(fk.target));
    const entity = pySnake(entityOf(fk.source));
    let many = pySnake(fk.source.label) || entity;
    if (many === entity) many = `${many}s`;
    const ambiguous = between.get(pair(fk))! > 1;
    const prefix = (name: string) => (ambiguous ? `${forward}_${name}` : name);
    const inverse = prefix(oneToOne ? entity : many);
    return { fk, forward, inverse, inverseMany: prefix(many), ambiguous, self: fk.source.id === fk.target.id, oneToOne };
  });
}
