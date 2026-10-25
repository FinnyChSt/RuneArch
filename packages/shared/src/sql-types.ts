import { DIALECTS, type SqlDialect } from './database';

/* ============================================================
 * Column types and defaults across SQL dialects.
 * Column types and defaults are free text in the project's dialect. In that dialect they are
 * used as written. For another dialect, known types are recognized by family (uuid, integers,
 * timestamps, json, ...) and rendered in the target; unknown ones pass through unchanged.
 * ============================================================ */

export type Translation = { from: SqlDialect; to: SqlDialect };

export type SqlTypeFamily =
  | 'uuid'
  | 'int8'
  | 'int16'
  | 'int32'
  | 'int64'
  | 'bool'
  | 'text'
  | 'varchar'
  | 'char'
  | 'decimal'
  | 'real'
  | 'double'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'timestamptz'
  | 'json'
  | 'jsonb'
  | 'blob';

const FAMILIES: Record<string, SqlTypeFamily> = {
  uuid: 'uuid',
  tinyint: 'int8',
  smallint: 'int16',
  int2: 'int16',
  mediumint: 'int32',
  int: 'int32',
  integer: 'int32',
  int4: 'int32',
  bigint: 'int64',
  int8: 'int64',
  boolean: 'bool',
  bool: 'bool',
  text: 'text',
  tinytext: 'text',
  mediumtext: 'text',
  longtext: 'text',
  clob: 'text',
  citext: 'text',
  varchar: 'varchar',
  'character varying': 'varchar',
  nvarchar: 'varchar',
  char: 'char',
  character: 'char',
  nchar: 'char',
  numeric: 'decimal',
  decimal: 'decimal',
  dec: 'decimal',
  real: 'real',
  float4: 'real',
  float: 'real',
  double: 'double',
  'double precision': 'double',
  float8: 'double',
  date: 'date',
  time: 'time',
  'time without time zone': 'time',
  timestamp: 'timestamp',
  'timestamp without time zone': 'timestamp',
  datetime: 'timestamp',
  timestamptz: 'timestamptz',
  'timestamp with time zone': 'timestamptz',
  json: 'json',
  jsonb: 'jsonb',
  bytea: 'blob',
  blob: 'blob',
  tinyblob: 'blob',
  mediumblob: 'blob',
  longblob: 'blob',
};

/** Auto-incrementing integer types, by the integer family they count in */
const SERIALS: Record<string, SqlTypeFamily> = {
  smallserial: 'int16',
  serial2: 'int16',
  serial: 'int32',
  serial4: 'int32',
  bigserial: 'int64',
  serial8: 'int64',
};

const PG_SERIAL: Partial<Record<SqlTypeFamily, string>> = { int8: 'smallserial', int16: 'smallserial', int32: 'serial', int64: 'bigserial' };

export type SqlColumnType = {
  type: string;
  /** Rendered by the dialect: serial types (PostgreSQL), AUTO_INCREMENT (MySQL), AUTOINCREMENT (SQLite) */
  autoIncrement: boolean;
  /** Set when the translation loses something, for a SQL comment */
  note?: string;
};

type ParsedType = { raw: string; base: string; args?: string; array: boolean; autoIncrement: boolean };

function parseType(raw: string): ParsedType {
  let rest = raw.trim();
  const autoIncrement = /\s+auto_?increment\b/i.test(rest);
  // MySQL modifiers; other dialects have no unsigned integers
  rest = rest.replace(/\s+(auto_?increment|unsigned|signed|zerofill)\b/gi, '');
  const array = /\[\]$/.test(rest);
  rest = rest.replace(/(\[\])+$/, '');
  const m = rest.match(/^([A-Za-z][\w ]*?)\s*(?:\(([^()]*)\))?(\s+with(out)? time zone)?$/);
  if (!m) return { raw, base: rest.toLowerCase(), array, autoIncrement };
  const base = `${m[1]!.toLowerCase().replace(/\s+/g, ' ')}${m[3] ? m[3].toLowerCase().replace(/\s+/g, ' ') : ''}`;
  return { raw, base, args: m[2]?.replace(/\s+/g, ''), array, autoIncrement };
}

const withArgs = (name: string, args?: string) => (args ? `${name}(${args})` : name);

/** A type of one family in PostgreSQL */
function pgType(family: SqlTypeFamily, args?: string): string {
  switch (family) {
    case 'int8':
    case 'int16':
      return 'smallint';
    case 'int32':
      return 'integer';
    case 'int64':
      return 'bigint';
    case 'bool':
      return 'boolean';
    case 'decimal':
      return withArgs('numeric', args);
    case 'double':
      return 'double precision';
    case 'time':
    case 'timestamp':
    case 'char':
    case 'varchar':
      return withArgs(family, args);
    case 'blob':
      return 'bytea';
    default:
      return family;
  }
}

/** A type of one family in MySQL/MariaDB; `indexed` text becomes varchar, which MySQL can index */
function mysqlType(family: SqlTypeFamily, dialect: 'mysql' | 'mariadb', args: string | undefined, indexed: boolean): string {
  switch (family) {
    case 'uuid':
      return dialect === 'mariadb' ? 'uuid' : 'char(36)';
    case 'int8':
      return 'tinyint';
    case 'int16':
      return 'smallint';
    case 'int32':
      return 'int';
    case 'int64':
      return 'bigint';
    case 'bool':
      return 'boolean';
    case 'text':
      return indexed ? 'varchar(255)' : 'text';
    case 'varchar':
      return `varchar(${args ?? '255'})`;
    case 'char':
      return withArgs('char', args);
    case 'decimal':
      return withArgs('decimal', args);
    case 'real':
      return 'float';
    case 'double':
      return 'double';
    case 'time':
      return withArgs('time', args);
    case 'timestamp':
      return withArgs('datetime', args);
    case 'timestamptz':
      return withArgs('timestamp', args);
    case 'json':
    case 'jsonb':
      return 'json';
    case 'blob':
      return 'longblob';
    default:
      return family;
  }
}

/** A type of one family in SQLite: its storage classes, keeping varchar/char/numeric as written */
function sqliteType(family: SqlTypeFamily, args?: string): string {
  switch (family) {
    case 'int8':
    case 'int16':
    case 'int32':
    case 'int64':
    case 'bool':
      return 'integer';
    case 'varchar':
    case 'char':
      return withArgs(family, args);
    case 'decimal':
      return withArgs('numeric', args);
    case 'real':
    case 'double':
      return 'real';
    case 'blob':
      return 'blob';
    default:
      return 'text';
  }
}

/** Names whose meaning depends on the dialect they were written in */
function familyOf(t: ParsedType, from: SqlDialect): SqlTypeFamily | undefined {
  const mysqlLike = from === 'mysql' || from === 'mariadb';
  if (t.base === 'tinyint' && t.args === '1') return 'bool'; // MySQL's boolean
  if (t.base === 'timestamp' && mysqlLike) return 'timestamptz'; // stored as UTC
  if (t.base === 'float' && from === 'postgresql') return 'double';
  return SERIALS[t.base] ?? FAMILIES[t.base];
}

/** A column type, as written for `dialect`, read by family; `family` is undefined for unknown types */
export type SqlTypeInfo = { family?: SqlTypeFamily; args?: string; array: boolean; autoIncrement: boolean };

export function sqlTypeInfo(raw: string, dialect: SqlDialect): SqlTypeInfo {
  const t = parseType(raw);
  return { family: familyOf(t, dialect), args: t.args, array: t.array, autoIncrement: t.autoIncrement || SERIALS[t.base] !== undefined };
}

/**
 * Renders a column type written for `from` in `to`.
 * `indexed` marks key and index columns: MySQL can't index `text`.
 */
export function translateType(raw: string, { from, to }: Translation, { indexed = false } = {}): SqlColumnType {
  if (from === to) return { type: raw.trim(), autoIncrement: false };
  const dialect = to;
  const t = parseType(raw);
  const family = familyOf(t, from);
  const autoIncrement = t.autoIncrement || SERIALS[t.base] !== undefined;

  if (!family) return { type: raw.trim(), autoIncrement: false };

  if (dialect === 'postgresql') {
    if (autoIncrement && PG_SERIAL[family]) return { type: PG_SERIAL[family]!, autoIncrement: true };
    return { type: `${pgType(family, t.args)}${t.array ? '[]' : ''}`, autoIncrement: false };
  }
  if (t.array)
    return {
      type: dialect === 'sqlite' ? 'text' : 'json',
      autoIncrement: false,
      note: `${t.raw.trim()}: ${DIALECTS[dialect].label} has no arrays`,
    };
  if (dialect === 'sqlite') return { type: sqliteType(family, t.args), autoIncrement };
  return { type: mysqlType(family, dialect, t.args, indexed), autoIncrement };
}

/* ------------------------------------------------------------
 * Defaults
 * ------------------------------------------------------------ */

/** `(expr)` → `expr` when the parentheses wrap the whole expression */
function unwrap(v: string): string {
  if (!v.startsWith('(') || !v.endsWith(')')) return v;
  let depth = 0;
  for (let i = 0; i < v.length; i++) {
    depth += v[i] === '(' ? 1 : v[i] === ')' ? -1 : 0;
    if (depth === 0 && i < v.length - 1) return v;
  }
  return unwrap(v.slice(1, -1).trim());
}

const isLiteral = (v: string) => /^-?\d+(\.\d+)?$/.test(v) || /^'([^']|'')*'$/.test(v) || /^null$/i.test(v);

const UUID_DEFAULT = /^(gen_random_uuid|uuid_generate_v4|uuid)\(\)$/i;
const NOW_DEFAULT = /^(now\(\)|current_timestamp(\(\))?|localtimestamp|datetime\('now'\))$/i;

/** Types MySQL only gives expression defaults, so a literal default needs parentheses */
const MYSQL_EXPRESSION_ONLY = /^(tiny|medium|long)?(text|blob)$|^json$/;

/** Renders a column default (a SQL literal or expression) written for `from` in `to` */
export function translateDefault(value: string, { from, to }: Translation, columnType: string): string {
  if (from === to) return value.trim();
  const dialect = to;
  let v = unwrap(value.trim());
  if (dialect !== 'postgresql') v = v.replace(/::[\w ]+(\[\])?$/, ''); // PostgreSQL casts: 'x'::text
  // Booleans may be written as 0/1 (MySQL, SQLite); PostgreSQL needs TRUE/FALSE
  const bool = v.match(/^(true|false)$/i) ?? (columnType === 'boolean' && /^[01]$/.test(v) ? [v, v === '1' ? 'true' : 'false'] : null);

  if (UUID_DEFAULT.test(v))
    return { postgresql: 'gen_random_uuid()', mysql: '(uuid())', mariadb: 'uuid()', sqlite: '(lower(hex(randomblob(16))))' }[dialect];
  if (NOW_DEFAULT.test(v)) return dialect === 'postgresql' ? 'now()' : 'CURRENT_TIMESTAMP';
  if (/^current_date(\(\))?$/i.test(v)) return dialect === 'mysql' ? '(CURRENT_DATE)' : 'CURRENT_DATE';
  if (bool) return dialect === 'sqlite' ? (bool[1]!.toLowerCase() === 'true' ? '1' : '0') : bool[1]!.toUpperCase();

  if (dialect === 'postgresql') return v;
  if (isLiteral(v))
    return dialect === 'mysql' && MYSQL_EXPRESSION_ONLY.test(columnType.toLowerCase()) ? `(${v})` : v;
  // Other expressions: MySQL and SQLite need them parenthesized, MariaDB accepts that too
  return /^\(.*\)$/.test(v) ? v : `(${v})`;
}
