import type { SqlDialect } from './database';
import {
  emptySchema,
  findColumn,
  findTable,
  onDeleteOf,
  type ImportedColumn,
  type ImportedSchema,
  type ImportedTable,
  type TableRef,
} from './schema-import';

/*
 * SQL DDL import: CREATE TABLE (columns, keys, inline and table-level constraints), CREATE INDEX,
 * ALTER TABLE ... ADD (foreign keys, keys) and COMMENT ON, in PostgreSQL, MySQL/MariaDB or SQLite
 * flavour. Other statements are skipped. Types and defaults are kept as written; auto-increment is
 * stored the way each dialect writes it (serial types, `auto_increment`, SQLite's integer key).
 * A `-- comment` after a column (as the SQL export writes notes) becomes the column note.
 */

type Token = {
  kind: 'word' | 'ident' | 'string' | 'number' | 'punct' | 'comment';
  /** Words as written; quoted identifiers and strings unquoted */
  value: string;
  start: number;
  end: number;
  line: number;
};

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const push = (kind: Token['kind'], value: string, start: number) => tokens.push({ kind, value, start, end: i, line });
  while (i < sql.length) {
    const ch = sql[i]!;
    const start = i;
    if (ch === '\n') {
      line++;
      i++;
    } else if (/\s/.test(ch)) i++;
    else if ((ch === '-' && sql[i + 1] === '-') || ch === '#') {
      while (i < sql.length && sql[i] !== '\n') i++;
      push('comment', sql.slice(start + (ch === '#' ? 1 : 2), i).trim(), start);
    } else if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? sql.length : close + 2;
      line += sql.slice(start, i).split('\n').length - 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      // Quotes escape by doubling ('it''s'); strings also take backslash escapes (MySQL)
      let value = '';
      i++;
      while (i < sql.length) {
        const c = sql[i]!;
        if (c === ch && sql[i + 1] === ch) {
          value += c;
          i += 2;
        } else if (c === ch) {
          i++;
          break;
        } else if (c === '\\' && ch === "'" && i + 1 < sql.length) {
          value += sql[i + 1];
          i += 2;
        } else {
          if (c === '\n') line++;
          value += c;
          i++;
        }
      }
      push(ch === "'" ? 'string' : 'ident', value, start);
    } else if (ch === '[' && sql[i + 1] !== ']' && /[\w\s]/.test(sql[i + 1] ?? '')) {
      // [name] identifiers (SQL Server style); `text[]` array suffixes stay punctuation
      const close = sql.indexOf(']', i);
      i = close === -1 ? sql.length : close + 1;
      push('ident', sql.slice(start + 1, i - 1), start);
    } else if (ch === '$' && /[$\w]/.test(sql[i + 1] ?? '')) {
      // $tag$ ... $tag$ bodies (functions): skipped as one string
      const tag = /^\$\w*\$/.exec(sql.slice(i))?.[0] ?? '$';
      const close = sql.indexOf(tag, i + tag.length);
      i = close === -1 ? sql.length : close + tag.length;
      line += sql.slice(start, i).split('\n').length - 1;
      push('string', sql.slice(start, i), start);
    } else if (/\d/.test(ch)) {
      while (i < sql.length && /[\d.]/.test(sql[i]!)) i++;
      push('number', sql.slice(start, i), start);
    } else if (/[A-Za-z_À-￿]/.test(ch)) {
      while (i < sql.length && /[\w$À-￿]/.test(sql[i]!)) i++;
      push('word', sql.slice(start, i), start);
    } else if (ch === ':' && sql[i + 1] === ':') {
      i += 2;
      push('punct', '::', start);
    } else {
      i++;
      push('punct', ch, start);
    }
  }
  return tokens;
}

/** Token stream over one statement */
class Stream {
  i = 0;
  constructor(
    readonly tokens: Token[],
    readonly source: string,
  ) {}
  peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }
  next(): Token | undefined {
    return this.tokens[this.i++];
  }
  done() {
    return this.i >= this.tokens.length;
  }
  /** Whether the next tokens are these words (case-insensitive) */
  is(...words: string[]) {
    return words.every((w, k) => {
      const t = this.peek(k);
      return t?.kind === 'word' && t.value.toLowerCase() === w;
    });
  }
  /** Consumes the words if they come next */
  accept(...words: string[]) {
    if (!this.is(...words)) return false;
    this.i += words.length;
    return true;
  }
  isPunct(p: string) {
    return this.peek()?.kind === 'punct' && this.peek()!.value === p;
  }
  acceptPunct(p: string) {
    if (!this.isPunct(p)) return false;
    this.i++;
    return true;
  }
  /** Skips a balanced (...) group if one comes next */
  skipGroup() {
    if (!this.isPunct('(')) return;
    let depth = 0;
    do {
      const t = this.next();
      if (t?.kind === 'punct' && t.value === '(') depth++;
      if (t?.kind === 'punct' && t.value === ')') depth--;
    } while (depth > 0 && !this.done());
  }
  /** Source text of tokens [from, to) */
  text(from: number, to: number) {
    const a = this.tokens[from];
    const b = this.tokens[to - 1];
    return a && b ? this.source.slice(a.start, b.end) : '';
  }
}

const isName = (t: Token | undefined) => t?.kind === 'word' || t?.kind === 'ident';

/** `name` or `schema.name` (the last part is the table) */
function qualifiedName(s: Stream): TableRef | null {
  const parts: string[] = [];
  do {
    const t = s.next();
    if (!isName(t)) return null;
    parts.push(t!.value);
  } while (s.acceptPunct('.'));
  const table = parts.pop()!;
  return { schema: parts.pop() ?? 'public', table };
}

/** `(a, b DESC, ...)` → column names; null if an entry isn't a plain column (an expression index) */
function columnList(s: Stream): string[] | null {
  if (!s.acceptPunct('(')) return null;
  const names: string[] = [];
  let plain = true;
  while (!s.done() && !s.isPunct(')')) {
    const t = s.next();
    if (isName(t) && (s.isPunct(',') || s.isPunct(')') || s.is('asc') || s.is('desc') || s.is('nulls') || s.is('collate')))
      names.push(t!.value);
    else if (!(t?.kind === 'punct' && t.value === ',')) {
      plain = false;
      if (t?.kind === 'punct' && t.value === '(') {
        s.i--;
        s.skipGroup();
      }
    }
    while (!s.done() && !s.isPunct(',') && !s.isPunct(')')) {
      if (s.isPunct('(')) s.skipGroup();
      else s.next();
    }
    s.acceptPunct(',');
  }
  s.acceptPunct(')');
  return plain ? names : null;
}

/** `REFERENCES t [(c, ...)] [ON DELETE x] [ON UPDATE y] [MATCH ...] [DEFERRABLE ...]` */
function references(s: Stream) {
  const to = qualifiedName(s);
  const columns = s.isPunct('(') ? (columnList(s) ?? []) : [];
  let onDelete: string | undefined;
  for (;;) {
    if (s.accept('on', 'delete') || s.accept('on', 'update')) {
      const isDelete = s.tokens[s.i - 1]!.value.toLowerCase() === 'delete';
      const action = s.accept('set', 'null')
        ? 'set null'
        : s.accept('set', 'default')
          ? 'set default'
          : s.accept('no', 'action')
            ? 'no action'
            : (s.next()?.value ?? '');
      if (isDelete) onDelete = action;
    } else if (s.accept('match')) s.next();
    else if (s.accept('not', 'deferrable') || s.accept('deferrable')) {
      s.accept('initially', 'deferred');
      s.accept('initially', 'immediate');
    } else break;
  }
  return to ? { to: { ...to, columns }, onDelete } : null;
}

/** Words that end a column's type (the start of a constraint or option) */
const TYPE_END = new Set(
  (
    'constraint primary not null unique default references check auto_increment autoincrement generated collate ' +
    'comment on charset identity as stored virtual invisible visible key'
  ).split(' '),
);

const SERIAL: Record<string, string> = { smallint: 'smallserial', int2: 'smallserial', int: 'serial', integer: 'serial', int4: 'serial', bigint: 'bigserial', int8: 'bigserial' };

type Pending = {
  table: ImportedTable;
  /** Foreign keys found in the table (resolved after every table is known) */
  refs: ImportedSchema['refs'];
};

/** One column definition, from its name to the next top-level comma */
function columnDef(s: Stream, end: number, dialect: SqlDialect, pending: Pending, warnings: string[]): ImportedColumn | null {
  const nameToken = s.next();
  if (!isName(nameToken)) return null;
  const column: ImportedColumn = { name: nameToken!.value, type: '', primaryKey: false, nullable: true, unique: false };

  // The type: everything up to the first constraint word, parentheses and all (`numeric(10, 2)`, `double precision`)
  const typeStart = s.i;
  while (s.i < end) {
    const t = s.peek()!;
    if (t.kind === 'word' && TYPE_END.has(t.value.toLowerCase())) break;
    if (t.kind === 'word' && t.value.toLowerCase() === 'character' && s.peek(1)?.value.toLowerCase() === 'set') break;
    if (t.kind === 'comment') break;
    if (t.kind === 'punct' && t.value === '(') s.skipGroup();
    else s.next();
  }
  column.type = s
    .text(typeStart, s.i)
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\[\s*\]/g, '[]')
    .trim();
  let autoIncrement = false;

  while (s.i < end) {
    // The last column has no comma, so its `-- note` falls inside its own tokens
    if (s.peek()?.kind === 'comment') {
      const c = s.next()!;
      if (!column.note) column.note = c.value;
      continue;
    }
    if (s.accept('constraint')) s.next();
    else if (s.accept('primary', 'key')) {
      column.primaryKey = true;
      column.nullable = false;
      if (!s.accept('asc')) s.accept('desc');
      if (s.accept('autoincrement')) autoIncrement = true;
    } else if (s.accept('not', 'null')) column.nullable = false;
    else if (s.accept('null')) column.nullable = true;
    else if (s.accept('unique')) {
      column.unique = true;
      s.accept('key');
    } else if (s.accept('default')) {
      // The expression runs to the next constraint word at the top level
      const from = s.i;
      while (s.i < end) {
        const t = s.peek()!;
        if (t.kind === 'comment' || (t.kind === 'word' && TYPE_END.has(t.value.toLowerCase()) && s.i > from)) break;
        if (t.kind === 'punct' && t.value === '(') s.skipGroup();
        else s.next();
      }
      column.default = s.text(from, s.i).trim();
    } else if (s.accept('references')) {
      const ref = references(s);
      if (ref) pending.refs.push({ from: { schema: pending.table.schema, table: pending.table.name, columns: [column.name] }, to: ref.to, onDelete: onDeleteOf(ref.onDelete) });
    } else if (s.accept('check')) s.skipGroup();
    else if (s.accept('auto_increment') || s.accept('autoincrement')) autoIncrement = true;
    else if (s.accept('identity')) {
      autoIncrement = true;
      s.skipGroup();
    } else if (s.accept('generated')) {
      if (!s.accept('always')) s.accept('by', 'default');
      if (s.accept('as', 'identity')) {
        autoIncrement = true;
        s.skipGroup();
      } else {
        s.accept('as');
        s.skipGroup();
        column.note = [column.note, 'generated column'].filter(Boolean).join('; ');
      }
    } else if (s.accept('as')) {
      s.skipGroup();
      column.note = [column.note, 'generated column'].filter(Boolean).join('; ');
    } else if (s.accept('collate') || s.accept('charset') || s.accept('character', 'set')) s.next();
    else if (s.accept('comment')) column.note = s.next()?.value;
    else if (s.accept('on', 'update')) {
      // MySQL `ON UPDATE CURRENT_TIMESTAMP`
      s.next();
      s.skipGroup();
    } else s.next();
  }

  if (autoIncrement) {
    const base = column.type.toLowerCase();
    if (dialect === 'postgresql') column.type = SERIAL[base] ?? column.type;
    else if (dialect === 'mysql' || dialect === 'mariadb') column.type = `${column.type} auto_increment`;
  }
  if (!column.type) warnings.push(`Column ${pending.table.name}.${column.name} has no type`);
  return column;
}

/** A table-level constraint or key; returns false when the item isn't one (it's a column) */
function tableConstraint(s: Stream, pending: Pending): boolean {
  const { table } = pending;
  const start = s.i;
  if (s.accept('constraint')) s.next();
  if (s.accept('primary', 'key')) {
    for (const name of columnList(s) ?? []) {
      const c = findColumn(table, name);
      if (c) Object.assign(c, { primaryKey: true, nullable: false });
    }
  } else if (s.accept('unique')) {
    if (!s.accept('key')) s.accept('index');
    const name = isName(s.peek()) && !s.isPunct('(') ? s.next()!.value : undefined;
    const cols = columnList(s) ?? [];
    if (cols.length === 1 && findColumn(table, cols[0]!)) findColumn(table, cols[0]!)!.unique = true;
    else if (cols.length > 1) table.indexes.push({ name, columns: cols, unique: true });
  } else if (s.accept('foreign', 'key')) {
    if (isName(s.peek())) s.next(); // MySQL index name
    const from = columnList(s) ?? [];
    if (s.accept('references')) {
      const ref = references(s);
      if (ref) pending.refs.push({ from: { schema: table.schema, table: table.name, columns: from }, to: ref.to, onDelete: onDeleteOf(ref.onDelete) });
    }
  } else if (s.accept('key') || s.accept('index')) {
    // MySQL inline index: KEY name (cols)
    const name = isName(s.peek()) ? s.next()!.value : undefined;
    const cols = columnList(s);
    if (cols?.length) table.indexes.push({ name, columns: cols, unique: false });
  } else if (s.accept('check') || s.accept('exclude') || s.accept('fulltext') || s.accept('spatial')) {
    // Not modelled
  } else {
    s.i = start;
    return false;
  }
  return true;
}

/** CREATE TABLE statement body */
function createTable(s: Stream, dialect: SqlDialect, schema: ImportedSchema, pendingRefs: ImportedSchema['refs']) {
  s.accept('if', 'not', 'exists');
  const name = qualifiedName(s);
  if (!name) return;
  if (!s.acceptPunct('(')) {
    schema.warnings.push(`Skipped table ${name.table}: no column list (CREATE TABLE ... AS / LIKE is not supported)`);
    return;
  }
  const table: ImportedTable = { schema: name.schema, name: name.table, columns: [], indexes: [] };
  const pending: Pending = { table, refs: pendingRefs };

  // Items are separated by top-level commas; a `-- comment` right after a column (same line) is its note
  let last: ImportedColumn | null = null;
  let lastLine = -1;
  for (;;) {
    while (s.peek()?.kind === 'comment') {
      const c = s.next()!;
      if (last && c.line === lastLine && !last.note) last.note = c.value;
    }
    if (s.done() || s.acceptPunct(')')) break;
    let end = s.i;
    let depth = 0;
    while (end < s.tokens.length) {
      const t = s.tokens[end]!;
      if (t.kind === 'punct' && t.value === '(') depth++;
      if (t.kind === 'punct' && t.value === ')') {
        if (depth === 0) break;
        depth--;
      }
      if (depth === 0 && t.kind === 'punct' && t.value === ',') break;
      end++;
    }
    if (!tableConstraint(s, pending)) {
      last = columnDef(s, end, dialect, pending, schema.warnings);
      if (last) table.columns.push(last);
      lastLine = s.tokens[Math.max(0, end - 1)]?.line ?? -1;
    } else last = null;
    s.i = end;
    if (s.isPunct(',')) {
      lastLine = s.peek()!.line;
      s.next();
    }
  }
  if (findTable(schema, name)) schema.warnings.push(`Table ${name.table} is defined twice; the last definition wins`);
  schema.tables = [...schema.tables.filter((t) => t !== findTable(schema, name)), table];
}

/** CREATE [UNIQUE] INDEX name ON table (cols) */
function createIndex(s: Stream, unique: boolean, schema: ImportedSchema) {
  s.accept('concurrently');
  s.accept('if', 'not', 'exists');
  const name = !s.is('on') && isName(s.peek()) ? s.next()!.value : undefined;
  if (!s.accept('on')) return;
  s.accept('only');
  const ref = qualifiedName(s);
  if (s.accept('using')) s.next();
  const columns = columnList(s);
  const table = ref && findTable(schema, ref);
  if (!table) schema.warnings.push(`Index ${name ?? ''} is on an unknown table ${ref?.table ?? ''}`.replace('  ', ' '));
  else if (!columns) schema.warnings.push(`Skipped index ${name ?? `on ${table.name}`}: expression indexes are not supported`);
  else table.indexes.push({ name, columns, unique });
}

/** ALTER TABLE t ADD [CONSTRAINT n] FOREIGN KEY / PRIMARY KEY / UNIQUE, or ADD [COLUMN] definition */
function alterTable(s: Stream, dialect: SqlDialect, schema: ImportedSchema, pendingRefs: ImportedSchema['refs']) {
  s.accept('only');
  s.accept('if', 'exists');
  s.accept('only');
  const ref = qualifiedName(s);
  const table = ref && findTable(schema, ref);
  if (!table) {
    if (ref) schema.warnings.push(`ALTER TABLE on an unknown table ${ref.table} was skipped`);
    return;
  }
  const pending: Pending = { table, refs: pendingRefs };
  while (!s.done()) {
    if (!s.accept('add')) {
      schema.warnings.push(`Skipped an ALTER TABLE ${table.name} change (only ADD is imported)`);
      return;
    }
    if (!tableConstraint(s, pending)) {
      s.accept('column');
      s.accept('if', 'not', 'exists');
      let end = s.i;
      while (end < s.tokens.length && !(s.tokens[end]!.kind === 'punct' && s.tokens[end]!.value === ',')) end++;
      const column = columnDef(s, end, dialect, pending, schema.warnings);
      if (column) table.columns.push(column);
      s.i = end;
    }
    if (!s.acceptPunct(',')) break;
  }
}

/** COMMENT ON TABLE t IS '...' / COMMENT ON COLUMN t.c IS '...' (PostgreSQL) */
function commentOn(s: Stream, schema: ImportedSchema) {
  const onTable = s.accept('table');
  if (!onTable && !s.accept('column')) return;
  const parts: string[] = [];
  do {
    const t = s.next();
    if (isName(t)) parts.push(t!.value);
  } while (s.acceptPunct('.'));
  if (!s.accept('is')) return;
  const text = s.next();
  const note = text?.kind === 'string' ? text.value : undefined;
  const column = onTable ? undefined : parts.pop();
  const tableName = parts.pop();
  const table = tableName && findTable(schema, { schema: parts.pop() ?? 'public', table: tableName });
  if (!table || !note) return;
  if (column) {
    const c = findColumn(table, column);
    if (c) c.note = note;
  } else table.note = note;
}

/** Statements that don't describe tables and are skipped without a warning */
const QUIET = /^(set|pragma|begin|commit|start|use|drop|create (schema|extension|database|sequence)|alter sequence|insert|lock|unlock)\b/i;

/** Parses a SQL script into tables, keys, indexes and foreign keys */
export function parseSqlSchema(sql: string, dialect: SqlDialect = 'postgresql'): ImportedSchema {
  const schema = emptySchema();
  const refs: ImportedSchema['refs'] = [];
  const all = tokenize(sql);
  let skipped = 0;

  // Statements end at top-level semicolons
  const statements: Token[][] = [];
  let current: Token[] = [];
  for (const t of all) {
    if (t.kind === 'punct' && t.value === ';') {
      statements.push(current);
      current = [];
    } else current.push(t);
  }
  statements.push(current);

  for (const tokens of statements) {
    const s = new Stream(tokens, sql);
    while (s.peek()?.kind === 'comment') s.next();
    if (s.done()) continue;
    const head = s.tokens
      .slice(s.i, s.i + 3)
      .map((t) => t.value)
      .join(' ');
    if (s.accept('create')) {
      s.accept('or', 'replace');
      while (s.accept('temporary') || s.accept('temp') || s.accept('unlogged') || s.accept('global') || s.accept('local')) {
        /* table kinds */
      }
      if (s.accept('table')) createTable(s, dialect, schema, refs);
      else if (s.accept('unique', 'index')) createIndex(s, true, schema);
      else if (s.accept('index')) createIndex(s, false, schema);
      else if (!QUIET.test(head)) skipped++;
    } else if (s.accept('alter', 'table')) alterTable(s, dialect, schema, refs);
    else if (s.accept('comment', 'on')) commentOn(s, schema);
    else if (!QUIET.test(head)) skipped++;
  }

  schema.refs = refs;
  if (skipped) schema.warnings.push(`Skipped ${skipped} statement${skipped === 1 ? '' : 's'} that don't define tables (views, types, functions, ...)`);
  return schema;
}
