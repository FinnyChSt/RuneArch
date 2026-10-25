import { elementIdOf, isInteractive, type CanvasDoc, type CanvasEdge, type CanvasNode, type EdgeKind, type NodeType } from '@flowcanvas/shared';
import { columnIdOf } from './handles';

export type LinkKind = Exclude<EdgeKind, 'fk'>;
export type FkData = Extract<CanvasEdge, { kind: 'fk' }>['data'];

type Rejected = { ok: false; reason: string };
export type LinkResult = { ok: true; kind: LinkKind } | Rejected;
export type ConnectResult = LinkResult | { ok: true; kind: 'fk'; data: FkData };

export type ConnectionInput = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

const FE: NodeType[] = ['screen', 'component', 'store'];

/** Picks the default edge kind for a connection between two nodes (ARCHITECTURE.md §7) */
export function inferEdgeKind(source: CanvasNode, target: CanvasNode): LinkResult {
  const s = source.type;
  const t = target.type;

  if (s === 'sketch' || t === 'sketch') return { ok: true, kind: 'arrow' };
  if (s === 'frame' || t === 'frame') return { ok: false, reason: 'Frames group nodes and cannot be connected' };
  if (s === 'table' && t === 'table')
    return { ok: false, reason: 'Drag from one column to another to create a foreign key' };

  if (s === 'screen' && t === 'screen') return { ok: true, kind: 'navigates' };
  if (FE.includes(s) && t === 'endpoint') return { ok: true, kind: 'calls' };
  if ((s === 'endpoint' || s === 'service') && (t === 'service' || t === 'external'))
    return { ok: true, kind: 'calls' };
  if ((s === 'endpoint' || s === 'service' || s === 'job') && t === 'table') return { ok: true, kind: 'writes' };
  // The way back from a table: data returned to the caller (pairs with a `writes` edge)
  if (s === 'table' && (t === 'endpoint' || t === 'service' || t === 'job')) return { ok: true, kind: 'reads' };
  if (t === 'job') return { ok: true, kind: 'emits' };

  // No obvious kind. A picker popover comes later; `calls` is the most common intent.
  return { ok: true, kind: 'calls' };
}

/** Column handle -> column handle: a foreign key from the source column to the referenced target column */
function checkForeignKey(doc: CanvasDoc, source: CanvasNode, target: CanvasNode, conn: ConnectionInput): ConnectResult {
  const sourceColumnId = columnIdOf(conn.sourceHandle);
  const targetColumnId = columnIdOf(conn.targetHandle);
  if (!sourceColumnId || !targetColumnId || source.type !== 'table' || target.type !== 'table')
    return { ok: false, reason: 'Connect a column to another column to create a foreign key' };

  const from = source.data.columns.find((c) => c.id === sourceColumnId);
  const to = target.data.columns.find((c) => c.id === targetColumnId);
  if (!from || !to) return { ok: false, reason: 'Unknown column' };
  if (from.id === to.id && source.id === target.id) return { ok: false, reason: 'A column cannot reference itself' };

  const exists = doc.edges.some(
    (e) => e.kind === 'fk' && e.data.sourceColumnId === from.id && e.data.targetColumnId === to.id,
  );
  if (exists) return { ok: false, reason: 'This foreign key already exists' };

  // A key or unique column can match at most one row on the other side
  const cardinality = from.primaryKey || from.unique ? '1:1' : 'n:1';
  return { ok: true, kind: 'fk', data: { sourceColumnId: from.id, targetColumnId: to.id, cardinality, onDelete: 'no action' } };
}

/** Whether either end of a connection is a table (such links can carry CRUD operations) */
export const touchesTable = (doc: CanvasDoc, conn: ConnectionInput) =>
  doc.nodes.some((n) => (n.id === conn.source || n.id === conn.target) && n.type === 'table');

/** Validates a connection against the current doc and infers its kind */
export function checkConnection(doc: CanvasDoc, conn: ConnectionInput): ConnectResult {
  const source = doc.nodes.find((n) => n.id === conn.source);
  const target = doc.nodes.find((n) => n.id === conn.target);
  if (!source || !target) return { ok: false, reason: 'Unknown node' };

  // Column to column is a foreign key; self-references are fine there (employees.manager_id -> employees.id).
  // A column handle on one end only (e.g. an endpoint dropped on a table row) is a plain table connection.
  if (columnIdOf(conn.sourceHandle) && columnIdOf(conn.targetHandle)) return checkForeignKey(doc, source, target, conn);
  if (source.id === target.id) return { ok: false, reason: 'A node cannot connect to itself' };

  // A screen element (button, form, ...) starts the link; the kind follows the screen's rules
  const elementId = elementIdOf(conn.sourceHandle);
  if (elementId !== null) {
    const element = source.type === 'screen' ? source.data.wireframe?.elements.find((el) => el.id === elementId) : undefined;
    if (!element) return { ok: false, reason: 'Unknown screen element' };
    if (!isInteractive(element.kind)) return { ok: false, reason: 'Only buttons, links, forms and lists can start a connection' };
  }

  const result = inferEdgeKind(source, target);
  if (!result.ok) return result;
  // Two buttons may call the same endpoint, and so may the screen itself: compare the starting element too
  const exists = doc.edges.some(
    (e) =>
      e.source === source.id &&
      e.target === target.id &&
      e.kind === result.kind &&
      elementIdOf(e.sourceHandle) === elementId,
  );
  return exists ? { ok: false, reason: 'These nodes are already connected' } : result;
}

/**
 * The arrow tool: a plain `arrow` between any two nodes (a note pointing at a table, a service at a
 * screen), whatever the connect rules would infer. Frames still can't be connected.
 */
export function checkArrow(doc: CanvasDoc, conn: ConnectionInput): LinkResult {
  const source = doc.nodes.find((n) => n.id === conn.source);
  const target = doc.nodes.find((n) => n.id === conn.target);
  if (!source || !target) return { ok: false, reason: 'Unknown node' };
  if (source.id === target.id) return { ok: false, reason: 'A node cannot connect to itself' };
  if (source.type === 'frame' || target.type === 'frame')
    return { ok: false, reason: 'Frames group nodes and cannot be connected' };
  const elementId = elementIdOf(conn.sourceHandle);
  if (elementId !== null) {
    const element = source.type === 'screen' ? source.data.wireframe?.elements.find((el) => el.id === elementId) : undefined;
    if (!element || !isInteractive(element.kind)) return { ok: false, reason: 'Only buttons, links, forms and lists can start a connection' };
  }
  const exists = doc.edges.some(
    (e) => e.kind === 'arrow' && e.source === source.id && e.target === target.id && elementIdOf(e.sourceHandle) === elementId,
  );
  return exists ? { ok: false, reason: 'These nodes are already connected by an arrow' } : { ok: true, kind: 'arrow' };
}
