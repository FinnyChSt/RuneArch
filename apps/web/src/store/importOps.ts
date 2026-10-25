import {
  convertDocDialect,
  estimateNodeSize,
  tableKey,
  type CanvasDoc,
  type CanvasEdge,
  type Column,
  type ImportedSchema,
  type ImportedTable,
  type SqlDialect,
  type TableNode,
} from '@flowcanvas/shared';
import { autoLayout } from '../canvas/arrange';
import { addEdge, moveNodes, removeElements } from './docOps';
import { absolutePosition, groupIntoFrame } from './layoutOps';
import { newId, type Position } from './nodeFactory';

/*
 * Merges a parsed database schema (SQL DDL or DBML import) into the canvas. Tables that already
 * exist (same schema and name) are updated in place: columns keep their ids by name, so existing
 * FKs and flows survive; columns the import no longer has are removed with their FKs. New tables
 * are laid out by their foreign keys next to the existing content, and DBML table groups become frames.
 */

export type SchemaImportResult = {
  doc: CanvasDoc;
  added: string[];
  updated: string[];
  /** Foreign keys added */
  refs: number;
  warnings: string[];
};

const keyOf = (t: TableNode) => tableKey({ schema: t.data.schema, table: t.label });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A table node from an imported table, reusing an existing node's id, place and column ids */
function toTableNode(table: ImportedTable, existing: TableNode | undefined): TableNode {
  const columns: Column[] = table.columns.map((c) => ({
    id: existing?.data.columns.find((old) => same(old.name, c.name))?.id ?? newId(),
    name: c.name,
    type: c.type || 'text',
    primaryKey: c.primaryKey,
    nullable: c.primaryKey ? false : c.nullable,
    unique: c.unique && !c.primaryKey,
    ...(c.default !== undefined && { default: c.default }),
    ...(c.note && { note: c.note }),
  }));
  const idOf = (name: string) => columns.find((c) => same(c.name, name))?.id;
  const indexes = table.indexes.flatMap((ix) => {
    const columnIds = ix.columns.map(idOf).filter((id): id is string => id !== undefined);
    return columnIds.length ? [{ id: newId(), ...(ix.name && { name: ix.name }), columnIds, unique: ix.unique }] : [];
  });
  return {
    id: existing?.id ?? newId(),
    type: 'table',
    label: table.name,
    position: existing?.position ?? { x: 0, y: 0 },
    ...(existing?.parentId && { parentId: existing.parentId }),
    ...(existing?.size && { size: existing.size }),
    ...((table.note ?? existing?.notes) && { notes: table.note ?? existing?.notes }),
    data: { schema: table.schema, columns, indexes },
  };
}

/**
 * The doc with the schema's tables and foreign keys in it (new tables at 0,0, see importSchema).
 * `sourceDialect`: the SQL dialect the types are written in, converted to the project's if different.
 */
export function buildSchemaImport(doc: CanvasDoc, schema: ImportedSchema, sourceDialect?: SqlDialect): SchemaImportResult {
  const warnings = [...schema.warnings];
  const existing = new Map(doc.nodes.filter((n): n is TableNode => n.type === 'table').map((t) => [keyOf(t), t]));
  let built = schema.tables.map((t) => toTableNode(t, existing.get(tableKey({ schema: t.schema, table: t.name }))));

  // Types and defaults written for another database are converted, like switching the project dialect
  const target = doc.database.dialect;
  if (sourceDialect && sourceDialect !== target) {
    const converted = convertDocDialect({ nodes: built, edges: [], database: { dialect: sourceDialect } }, target);
    built = converted.nodes as TableNode[];
  }

  const builtIds = new Set(built.map((t) => t.id));
  const added = built.filter((t) => !doc.nodes.some((n) => n.id === t.id)).map((t) => t.id);
  const updated = built.filter((t) => !added.includes(t.id)).map((t) => t.id);

  // Columns an updated table lost take their FKs (and the flow steps using them) along
  const keptColumns = new Set(built.flatMap((t) => t.data.columns.map((c) => c.id)));
  const lostColumns = new Set(
    doc.nodes.flatMap((n) => (n.type === 'table' && builtIds.has(n.id) ? n.data.columns.map((c) => c.id) : [])).filter((id) => !keptColumns.has(id)),
  );
  const staleFks = doc.edges
    .filter((e) => e.kind === 'fk' && (lostColumns.has(e.data.sourceColumnId) || lostColumns.has(e.data.targetColumnId)))
    .map((e) => e.id);

  const byId = new Map(built.map((t) => [t.id, t]));
  let next: CanvasDoc = {
    ...doc,
    nodes: [...doc.nodes.map((n) => byId.get(n.id) ?? n), ...built.filter((t) => added.includes(t.id))],
  };
  next = removeElements(next, staleFks);

  // Foreign keys: to imported tables or to tables already on the canvas; composite keys pair up by position
  const tables = new Map(next.nodes.filter((n): n is TableNode => n.type === 'table').map((t) => [keyOf(t), t]));
  let refs = 0;
  for (const ref of schema.refs) {
    const from = tables.get(tableKey(ref.from));
    const to = tables.get(tableKey(ref.to));
    if (!from || !to) {
      warnings.push(`Skipped a foreign key from ${ref.from.table} to ${ref.to.table}: table not found`);
      continue;
    }
    const toColumns = ref.to.columns.length ? ref.to.columns : to.data.columns.filter((c) => c.primaryKey).map((c) => c.name);
    ref.from.columns.forEach((name, i) => {
      const source = from.data.columns.find((c) => same(c.name, name));
      const target = to.data.columns.find((c) => same(c.name, toColumns[i] ?? ''));
      if (!source || !target) {
        warnings.push(`Skipped a foreign key ${from.label}.${name} → ${to.label}: column not found`);
        return;
      }
      const exists = next.edges.some(
        (e) => e.kind === 'fk' && e.data.sourceColumnId === source.id && e.data.targetColumnId === target.id,
      );
      if (exists) return;
      const edge: CanvasEdge = {
        id: newId(),
        kind: 'fk',
        source: from.id,
        target: to.id,
        data: {
          sourceColumnId: source.id,
          targetColumnId: target.id,
          cardinality: ref.oneToOne || source.primaryKey || source.unique ? '1:1' : 'n:1',
          onDelete: ref.onDelete,
        },
      };
      next = addEdge(next, edge);
      refs++;
    });
  }
  return { doc: next, added, updated, refs, warnings };
}

/** Space between the existing content and imported tables */
const GAP = 160;

/**
 * The whole import: build, lay out the new tables by their foreign keys (elkjs) right of the existing
 * content, and wrap DBML table groups in frames. The result commits as one undo step.
 */
export async function importSchema(doc: CanvasDoc, schema: ImportedSchema, sourceDialect?: SqlDialect): Promise<SchemaImportResult> {
  const result = buildSchemaImport(doc, schema, sourceDialect);
  let next = result.doc;
  const added = new Set(result.added);
  if (added.size) {
    const sizeOf = estimateNodeSize;
    const rects = next.nodes.filter((n) => added.has(n.id)).map((n) => ({ id: n.id, x: 0, y: 0, ...sizeOf(n) }));
    const edges = next.edges.filter((e) => added.has(e.source) && added.has(e.target));
    const laid = rects.length > 1 ? await autoLayout(rects, edges) : { [rects[0]!.id]: { x: 0, y: 0 } };

    // Anchor: right of what's on the canvas, top-aligned with it
    const others = doc.nodes.map((n) => ({ ...absolutePosition(doc, n), ...(n.size ?? estimateNodeSize(n)) }));
    const origin: Position = others.length
      ? { x: Math.max(...others.map((o) => o.x + o.width)) + GAP, y: Math.min(...others.map((o) => o.y)) }
      : { x: 0, y: 0 };
    const minX = Math.min(...Object.values(laid).map((p) => p.x));
    const minY = Math.min(...Object.values(laid).map((p) => p.y));
    next = moveNodes(
      next,
      Object.fromEntries(Object.entries(laid).map(([id, p]) => [id, { x: Math.round(origin.x + p.x - minX), y: Math.round(origin.y + p.y - minY) }])),
    );

    // Table groups: new tables that belong together get a frame
    for (const group of schema.groups) {
      const keys = new Set(group.tables.map(tableKey));
      const members = next.nodes.filter((n): n is TableNode => n.type === 'table' && added.has(n.id) && !n.parentId && keys.has(keyOf(n)));
      if (members.length) next = groupIntoFrame(next, members.map((m) => m.id), sizeOf, group.name).doc;
    }
  }
  return { ...result, doc: next };
}
