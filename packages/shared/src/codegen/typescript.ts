/* ============================================================
 * TypeScript source helpers shared by the TypeScript generators (Zod, Drizzle)
 * ============================================================ */

/** A single-quoted string literal */
export const tsString = (text: string) =>
  `'${text.replace(/[\\'\n\r\u2028\u2029]/g, (c) => ({ '\n': '\\n', '\r': '\\r', '\u2028': '\\u2028', '\u2029': '\\u2029' })[c] ?? `\\${c}`)}'`;

/** A JSDoc block; `*\/` in the text can't end it early */
export function jsDoc(lines: string[], indent: string): string[] {
  const text = lines.flatMap((l) => l.trim().split('\n')).map((l) => l.trimEnd().replaceAll('*/', '*\\/'));
  if (text.length === 0) return [];
  if (text.length === 1) return [`${indent}/** ${text[0]} */`];
  return [`${indent}/**`, ...text.map((l) => `${indent} *${l ? ` ${l}` : ''}`), `${indent} */`];
}
