import { z } from 'zod';

/* ============================================================
 * Project database: the SQL dialect tables are designed for.
 * It drives type suggestions, the table dialog's SQL tab and the default SQL export.
 * ============================================================ */

export const SqlDialect = z.enum(['postgresql', 'mysql', 'mariadb', 'sqlite']);
export type SqlDialect = z.infer<typeof SqlDialect>;

export const DatabaseSettings = z.object({
  dialect: SqlDialect.default('postgresql'),
});
export type DatabaseSettings = z.infer<typeof DatabaseSettings>;

type DialectInfo = {
  label: string;
  /** Oldest version the generated SQL targets */
  minVersion: string;
  /** Type suggestions in the table dialog */
  types: string[];
  /** Column type of a new table's `id` */
  idType: string;
};

export const DIALECTS: Record<SqlDialect, DialectInfo> = {
  postgresql: {
    label: 'PostgreSQL',
    minVersion: '13',
    types: ['uuid', 'text', 'varchar(255)', 'integer', 'bigint', 'bigserial', 'numeric(12,2)', 'boolean', 'date', 'timestamptz', 'jsonb'],
    idType: 'uuid',
  },
  mysql: {
    label: 'MySQL',
    minVersion: '8.0.13',
    types: ['char(36)', 'varchar(255)', 'text', 'int', 'bigint', 'decimal(12,2)', 'boolean', 'date', 'datetime', 'timestamp', 'json'],
    idType: 'char(36)',
  },
  mariadb: {
    label: 'MariaDB',
    minVersion: '10.7',
    types: ['uuid', 'varchar(255)', 'text', 'int', 'bigint', 'decimal(12,2)', 'boolean', 'date', 'datetime', 'timestamp', 'json'],
    idType: 'uuid',
  },
  sqlite: {
    label: 'SQLite',
    minVersion: '3.35',
    types: ['text', 'integer', 'real', 'numeric', 'blob'],
    idType: 'text',
  },
};

export const SQL_DIALECTS = SqlDialect.options;
