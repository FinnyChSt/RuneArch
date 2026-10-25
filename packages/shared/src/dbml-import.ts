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
 * DBML import (https://dbml.dbdiagram.io/docs): tables with column settings (pk, not null, unique,
 * increment, default, note, inline ref), indexes, notes, `Ref`s (short and block form, with
 * `delete:` actions) and table groups. Enums keep their name as the column type; projects, notes
 * and table partials are skipped. `increment` becomes the target dialect's auto-increment.
 */

type Token = { kind: 'word' | 'string' | 'expr' | 'number' | 'punct'; value: string; line: number };

/** Multi-line ''' strings: drop the blank first and last lines and the common indentation, like DBML */
function dedent(raw: string): string {
  const lines = raw.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\n') {
      line++;
      i++;
    } else if (/\s/.test(ch)) i++;
    else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      line += src.slice(i, end).split('\n').length - 1;
      i = end;
    } else if (src.startsWith("'''", i)) {
      const close = src.indexOf("'''", i + 3);
      const end = close === -1 ? src.length : close;
      const raw = src.slice(i + 3, end);
      tokens.push({ kind: 'string', value: dedent(raw.replace(/\\'/g, "'")), line });
      line += raw.split('\n').length - 1;
      i = end + 3;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let value = '';
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\' && i + 1 < src.length) {
          value += src[i + 1];
          i += 2;
        } else {
          if (src[i] === '\n') line++;
          value += src[i];
          i++;
        }
      }
      i++;
      // "quoted" is a name, 'single' a string, `backticks` an expression
      tokens.push({ kind: ch === '"' ? 'word' : ch === "'" ? 'string' : 'expr', value, line });
    } else if (/[\d]/.test(ch) || (ch === '-' && /\d/.test(src[i + 1] ?? '') && /[:,[\s]/.test(src[i - 1] ?? ' ') && !/[<>]/.test(src[i - 2] ?? ''))) {
      const start = i;
      i++;
      while (i < src.length && /[\d.]/.test(src[i]!)) i++;
      tokens.push({ kind: 'number', value: src.slice(start, i), line });
    } else if (/[\wÀ-￿]/.test(ch)) {
      const start = i;
      while (i < src.length && /[\wÀ-￿]/.test(src[i]!)) i++;
      tokens.push({ kind: 'word', value: src.slice(start, i), line });
    } else if (ch === '<' && src[i + 1] === '>') {
      tokens.push({ kind: 'punct', value: '<>', line });
      i += 2;
    } else if (ch === '#') {
      // Colors (#3498DB) in settings
      const start = i;
      i++;
      while (i < src.length && /\w/.test(src[i]!)) i++;
      tokens.push({ kind: 'word', value: src.slice(start, i), line });
    } else {
      tokens.push({ kind: 'punct', value: ch, line });
      i++;
    }
  }
  return tokens;
}

class Stream {
  i = 0;
  constructor(readonly tokens: Token[]) {}
  peek(offset = 0) {
    return this.tokens[this.i + offset];
  }
  next() {
    return this.tokens[this.i++];
  }
  done() {
    return this.i >= this.tokens.length;
  }
  isWord(w: string, offset = 0) {
    const t = this.peek(offset);
    return t?.kind === 'word' && t.value.toLowerCase() === w;
  }
  isPunct(p: string, offset = 0) {
    const t = this.peek(offset);
    return t?.kind === 'punct' && t.value === p;
  }
  acceptPunct(p: string) {
    if (!this.isPunct(p)) return false;
    this.i++;
    return true;
  }
  /** Skips a balanced block starting at the next `open` */
  skipBlock(open = '{', close = '}') {
    if (!this.isPunct(open)) return;
    let depth = 0;
    do {
      const t = this.next();
      if (t?.kind === 'punct' && t.value === open) depth++;
      if (t?.kind === 'punct' && t.value === close) depth--;
    } while (depth > 0 && !this.done());
  }
}

type Setting = { key: string; value?: Token[] };

/** `[a, b: value, c: 'x']`; values run to the next top-level comma */
function settings(s: Stream): Setting[] {
  if (!s.acceptPunct('[')) return [];
  const out: Setting[] = [];
  while (!s.done() && !s.acceptPunct(']')) {
    const keyParts: string[] = [];
    while (!s.done() && !s.isPunct(':') && !s.isPunct(',') && !s.isPunct(']')) keyParts.push(s.next()!.value);
    const setting: Setting = { key: keyParts.join(' ').toLowerCase() };
    if (s.acceptPunct(':')) {
      setting.value = [];
      while (!s.done() && !s.isPunct(',') && !s.isPunct(']')) setting.value.push(s.next()!);
    }
    out.push(setting);
    s.acceptPunct(',');
  }
  return out;
}

/** `name`, `schema.name` or `schema.table.column`-style dotted names */
function dotted(s: Stream): string[] {
  const parts: string[] = [];
  do {
    const t = s.next();
    if (t?.kind !== 'word') break;
    parts.push(t.value);
  } while (s.acceptPunct('.') && !s.isPunct('('));
  return parts;
}

/** A default value as SQL: strings quoted, `expressions` raw, numbers and keywords as they are */
function sqlDefault(value: Token[] | undefined): string | undefined {
  const t = value?.[0];
  if (!t) return undefined;
  if (t.kind === 'string') return `'${t.value.replaceAll("'", "''")}'`;
  return value!.map((v) => v.value).join('');
}

type Endpoint = TableRef & { columns: string[] };

/** `table.col`, `schema.table.col` or `table.(a, b)` */
function endpoint(s: Stream, aliases: Map<string, TableRef>): Endpoint | null {
  const parts = dotted(s);
  let columns: string[];
  if (s.acceptPunct('(')) {
    columns = [];
    while (!s.done() && !s.acceptPunct(')')) {
      const t = s.next()!;
      if (t.kind === 'word') columns.push(t.value);
    }
  } else columns = parts.length > 1 ? [parts.pop()!] : [];
  if (parts.length === 0 || columns.length === 0) return null;
  const table = parts.pop()!;
  const aliased = parts.length === 0 ? aliases.get(table.toLowerCase()) : undefined;
  return aliased ? { ...aliased, columns } : { schema: parts.pop() ?? 'public', table, columns };
}

const SERIAL: Record<string, string> = { smallint: 'smallserial', int: 'serial', integer: 'serial', bigint: 'bigserial' };

/** `ref: > t.c` inside a column's settings, or the body of a Ref */
function relation(
  left: Endpoint,
  op: string,
  right: Endpoint,
  refSettings: Setting[],
  schema: ImportedSchema,
): void {
  if (op === '<>') {
    schema.warnings.push(`Skipped the many-to-many ref between ${left.table} and ${right.table} (add a join table)`);
    return;
  }
  const [from, to] = op === '<' ? [right, left] : [left, right];
  const onDelete = onDeleteOf(refSettings.find((x) => x.key === 'delete')?.value?.map((t) => t.value).join(' '));
  schema.refs.push({ from, to, onDelete, oneToOne: op === '-' || undefined });
}

/** Parses DBML into tables, refs and table groups */
export function parseDbml(src: string, dialect: SqlDialect = 'postgresql'): ImportedSchema {
  const schema = emptySchema();
  const s = new Stream(tokenize(src));
  const aliases = new Map<string, TableRef>();
  /** Inline refs wait until every table (and alias) is known */
  const inline: { left: Endpoint; op: string; right: () => Endpoint | null }[] = [];
  const pendingRefs: (() => void)[] = [];

  while (!s.done()) {
    const head = s.peek()!;
    const word = head.kind === 'word' ? head.value.toLowerCase() : '';
    if (word === 'table') {
      s.next();
      const parts = dotted(s);
      const table: ImportedTable = { schema: parts.length > 1 ? parts[0]! : 'public', name: parts.at(-1) ?? 'table', columns: [], indexes: [] };
      if (s.isWord('as')) {
        s.next();
        const alias = s.next()?.value;
        if (alias) aliases.set(alias.toLowerCase(), { schema: table.schema, table: table.name });
      }
      const tableSettings = settings(s);
      const tableNote = tableSettings.find((x) => x.key === 'note')?.value?.[0];
      if (tableNote?.kind === 'string') table.note = tableNote.value;
      if (!s.acceptPunct('{')) continue;
      while (!s.done() && !s.acceptPunct('}')) {
        if (s.isWord('indexes') && s.isPunct('{', 1)) {
          s.next();
          s.next();
          while (!s.done() && !s.acceptPunct('}')) {
            let columns: string[] = [];
            let expression = false;
            if (s.acceptPunct('(')) {
              while (!s.done() && !s.acceptPunct(')')) {
                const t = s.next()!;
                if (t.kind === 'word') columns.push(t.value);
                if (t.kind === 'expr') expression = true;
              }
            } else {
              const t = s.next()!;
              if (t.kind === 'word') columns = [t.value];
              else expression = true;
            }
            const ix = settings(s);
            const name = ix.find((x) => x.key === 'name')?.value?.[0]?.value;
            if (expression) schema.warnings.push(`Skipped an expression index on ${table.name}`);
            else if (ix.some((x) => x.key === 'pk'))
              columns.forEach((n) => {
                const c = findColumn(table, n);
                if (c) Object.assign(c, { primaryKey: true, nullable: false });
              });
            else if (columns.length === 1 && ix.some((x) => x.key === 'unique') && !name && findColumn(table, columns[0]!))
              findColumn(table, columns[0]!)!.unique = true;
            else if (columns.length) table.indexes.push({ name, columns, unique: ix.some((x) => x.key === 'unique') });
          }
          continue;
        }
        if (s.isWord('note') && (s.isPunct(':', 1) || s.isPunct('{', 1))) {
          s.next();
          const braced = !s.acceptPunct(':') && s.acceptPunct('{');
          const t = s.next();
          if (t?.kind === 'string') table.note = t.value;
          if (braced) s.acceptPunct('}');
          continue;
        }
        // A column: name type[(args)] [settings], on one line
        const nameToken = s.next()!;
        if (nameToken.kind !== 'word') continue;
        const typeParts = dotted(s);
        let type = typeParts.join('.');
        if (s.isPunct('(') && s.peek()!.line === nameToken.line) {
          const args: string[] = [];
          s.next();
          while (!s.done() && !s.acceptPunct(')')) args.push(s.next()!.value);
          type += `(${args.join('').replace(/,/g, ',')})`;
        }
        const column: ImportedColumn = { name: nameToken.value, type, primaryKey: false, nullable: true, unique: false };
        const colSettings = s.isPunct('[') && s.peek()!.line === nameToken.line ? settings(s) : [];
        let increment = false;
        for (const x of colSettings) {
          if (x.key === 'pk' || x.key === 'primary key') Object.assign(column, { primaryKey: true, nullable: false });
          else if (x.key === 'not null') column.nullable = false;
          else if (x.key === 'null') column.nullable = true;
          else if (x.key === 'unique') column.unique = true;
          else if (x.key === 'increment') increment = true;
          else if (x.key === 'default') column.default = sqlDefault(x.value);
          else if (x.key === 'note' && x.value?.[0]?.kind === 'string') column.note = x.value[0].value;
          else if (x.key === 'ref' && x.value?.length) {
            const tokens = x.value;
            const op = tokens[0]!.value;
            const rest = new Stream(tokens.slice(1));
            const left = { schema: table.schema, table: table.name, columns: [column.name] };
            inline.push({ left, op, right: () => endpoint(rest, aliases) });
          }
        }
        if (increment) {
          if (dialect === 'postgresql') column.type = SERIAL[column.type.toLowerCase()] ?? column.type;
          else if (dialect === 'mysql' || dialect === 'mariadb') column.type = `${column.type} auto_increment`;
        }
        table.columns.push(column);
      }
      schema.tables.push(table);
    } else if (word === 'ref') {
      s.next();
      if (s.peek()?.kind === 'word' && !s.isPunct(':')) s.next(); // ref name
      const block = !s.acceptPunct(':') && s.acceptPunct('{');
      do {
        const left = endpoint(s, aliases);
        const op = s.next()?.value ?? '';
        const right = endpoint(s, aliases);
        const refSettings = settings(s);
        if (left && right) pendingRefs.push(() => relation(left, op, right, refSettings, schema));
        else schema.warnings.push('Skipped a ref that could not be read');
      } while (block && !s.done() && !s.isPunct('}'));
      if (block) s.acceptPunct('}');
    } else if (word === 'tablegroup') {
      s.next();
      const name = s.next()?.value ?? 'Group';
      settings(s);
      const tables: TableRef[] = [];
      if (s.acceptPunct('{')) {
        while (!s.done() && !s.acceptPunct('}')) {
          if (s.isWord('note')) {
            s.next();
            if (s.acceptPunct(':')) s.next();
            else s.skipBlock();
            continue;
          }
          const parts = dotted(s);
          if (parts.length === 0) {
            s.next();
            continue;
          }
          const tableName = parts.pop()!;
          tables.push(aliases.get(tableName.toLowerCase()) ?? { schema: parts.pop() ?? 'public', table: tableName });
        }
      }
      schema.groups.push({ name, tables });
    } else if (word === 'project' || word === 'enum' || word === 'note' || word === 'tablepartial' || word === 'records') {
      s.next();
      if (word === 'tablepartial') schema.warnings.push('Skipped a TablePartial (not supported)');
      while (!s.done() && !s.isPunct('{')) s.next();
      s.skipBlock();
    } else s.next();
  }

  for (const { left, op, right } of inline) {
    const r = right();
    if (r) relation(left, op, r, [], schema);
  }
  pendingRefs.forEach((add) => add());
  for (const g of schema.groups)
    g.tables = g.tables.filter((t) => {
      const ok = findTable(schema, t) !== undefined;
      if (!ok) schema.warnings.push(`Table group ${g.name} names an unknown table ${t.table}`);
      return ok;
    });
  return schema;
}
