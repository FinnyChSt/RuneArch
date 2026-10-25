/* ============================================================
 * Python source helpers shared by the Python generators (Pydantic, SQLAlchemy)
 * ============================================================ */

const KEYWORDS = new Set(
  (
    'False None True and as assert async await break class continue def del elif else except finally for from ' +
    'global if import in is lambda nonlocal not or pass raise return try while with yield'
  ).split(' '),
);

/** A Python string literal; JSON escapes are valid Python escapes */
export const pyString = (text: string) => JSON.stringify(text);

/** `orderId` → `order_id`, `created at` → `created_at`, `HTTPStatus` → `http_status` */
export const pySnake = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

/**
 * A safe attribute name: snake_case, never a keyword or a `reserved` name (imported types,
 * base-class members), never starting with a digit or `_` (private in Pydantic). Clashes get a `_` suffix.
 */
export function pyAttr(name: string, reserved: ReadonlySet<string>): string {
  let attr = pySnake(name) || 'field';
  if (/^\d/.test(attr)) attr = `f_${attr}`;
  return KEYWORDS.has(attr) || reserved.has(attr) ? `${attr}_` : attr;
}

/** A class name as given when it's a safe identifier, else with a `_` suffix */
export const pyClass = (name: string, reserved: ReadonlySet<string>) =>
  KEYWORDS.has(name) || reserved.has(name) ? `${name}_` : name;

/** `base`, else `base_2`, `base_3`, ...; adds the result to `used` */
export function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
  used.add(name);
  return name;
}

/** A docstring; text that would need escapes in triple quotes becomes one plain string literal */
export function pyDocstring(text: string, indent: string): string[] {
  const t = text.trim();
  if (/\\|"""|"$/.test(t)) return [`${indent}${pyString(t)}`];
  const lines = t.split('\n');
  if (lines.length === 1) return [`${indent}"""${t}"""`];
  return [`${indent}"""${lines[0]}`, ...lines.slice(1).map((l) => (l.trim() ? `${indent}${l.trimEnd()}` : '')), `${indent}"""`];
}

/** One `# ...` line per line of text */
export const pyComment = (text: string, indent = '') =>
  text
    .trim()
    .split('\n')
    .map((l) => `${indent}# ${l.trim()}`.trimEnd());

/** A JSON value as a Python literal */
export function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return pyString(value);
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${pyString(k)}: ${pyLiteral(v)}`)
    .join(', ')}}`;
}

/** Collects `from module import name` while rendering */
export class ImportSet {
  private readonly modules = new Map<string, Set<string>>();

  add(module: string, ...names: string[]) {
    const set = this.modules.get(module) ?? new Set<string>();
    names.forEach((n) => set.add(n));
    this.modules.set(module, set);
  }

  /** Sorted `from module import a, b` lines */
  lines(): string[] {
    return [...this.modules]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([module, names]) => `from ${module} import ${[...names].sort().join(', ')}`);
  }
}

/** Standard-library imports, a blank line, then third-party imports, then the package's own (PEP 8) */
export const importBlock = (stdlib: ImportSet, thirdParty: ImportSet, local?: ImportSet) =>
  [stdlib.lines(), thirdParty.lines(), local?.lines() ?? []].filter((group) => group.length > 0).map((group) => group.join('\n'));
