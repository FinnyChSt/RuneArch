import type { CanvasDoc, TableNode } from '@flowcanvas/shared';
import { applyTableEdit, type ColumnRef } from '../store/docOps';
import { newId } from '../store/nodeFactory';
import type { IssueMapper } from './validation';

/*
 * Table dialog draft. Each column carries its foreign key (`ref`), so the dialog can edit
 * FK edges alongside the columns; applyTableEdit turns it back into node + edges in one step.
 */

export type OnDelete = ColumnRef['onDelete'];
export const ON_DELETE: OnDelete[] = ['no action', 'cascade', 'set null', 'restrict'];

export type ColumnDraft = {
  id: string;
  name: string;
  type: string;
  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
  default: string;
  note: string;
  /** `tableId::columnId` of the referenced column, or '' */
  ref: string;
  onDelete: OnDelete;
};

export type IndexDraft = { id: string; name: string; columnIds: string[]; unique: boolean };

export type TableDraft = {
  label: string;
  schema: string;
  notes: string;
  columns: ColumnDraft[];
  indexes: IndexDraft[];
};

export const refValue = (tableId: string, columnId: string) => `${tableId}::${columnId}`;

const parseRef = (ref: string): ColumnRef['target'] => {
  const [tableId, columnId] = ref.split('::');
  return tableId && columnId ? { tableId, columnId } : null;
};

export const newColumnDraft = (): ColumnDraft => ({
  id: newId(),
  name: '',
  type: 'text',
  primaryKey: false,
  nullable: true,
  unique: false,
  default: '',
  note: '',
  ref: '',
  onDelete: 'no action',
});

export const newIndexDraft = (): IndexDraft => ({ id: newId(), name: '', columnIds: [], unique: false });

export function toTableDraft(node: TableNode, doc: CanvasDoc): TableDraft {
  return {
    label: node.label,
    schema: node.data.schema,
    notes: node.notes ?? '',
    columns: node.data.columns.map((c) => {
      const fk = doc.edges.find((e) => e.kind === 'fk' && e.source === node.id && e.data.sourceColumnId === c.id);
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        primaryKey: c.primaryKey,
        nullable: c.nullable,
        unique: c.unique,
        default: c.default ?? '',
        note: c.note ?? '',
        ref: fk?.kind === 'fk' ? refValue(fk.target, fk.data.targetColumnId) : '',
        onDelete: fk?.kind === 'fk' ? fk.data.onDelete : 'no action',
      };
    }),
    indexes: node.data.indexes.map((ix) => ({
      id: ix.id,
      name: ix.name ?? '',
      columnIds: ix.columnIds,
      unique: ix.unique,
    })),
  };
}

export function fromTableDraft(node: TableNode, draft: TableDraft): { node: TableNode; refs: ColumnRef[] } {
  const columnIds = new Set(draft.columns.map((c) => c.id));
  return {
    node: {
      ...node,
      label: draft.label.trim(),
      notes: draft.notes.trim() || undefined,
      data: {
        ...node.data,
        schema: draft.schema.trim() || 'public',
        columns: draft.columns.map((c) => ({
          id: c.id,
          name: c.name.trim(),
          type: c.type.trim(),
          primaryKey: c.primaryKey,
          // Primary keys are never nullable
          nullable: c.primaryKey ? false : c.nullable,
          unique: c.unique,
          default: c.default.trim() || undefined,
          note: c.note.trim() || undefined,
        })),
        indexes: draft.indexes.map((ix) => ({
          id: ix.id,
          name: ix.name.trim() || undefined,
          // Deleted columns leave their indexes
          columnIds: ix.columnIds.filter((id) => columnIds.has(id)),
          unique: ix.unique,
        })),
      },
    },
    refs: draft.columns.map((c) => ({ columnId: c.id, target: parseRef(c.ref), onDelete: c.onDelete })),
  };
}

/** The doc as it would be after saving this draft */
export function buildTableDoc(doc: CanvasDoc, node: TableNode, draft: TableDraft): CanvasDoc {
  const { node: table, refs } = fromTableDraft(node, draft);
  return applyTableEdit(doc, table, refs);
}

const COLUMN_FIELDS = new Set(['name', 'type', 'default']);

export const tableMapper = (tableId: string, draft: TableDraft): IssueMapper => ({
  node: ([key, sub, index, field]) => {
    if (key === 'label' || key === 'notes') return key;
    if (key !== 'data') return null;
    if (sub === 'schema') return 'schema';
    if (sub === 'columns' && typeof index === 'number')
      return `columns.${index}.${COLUMN_FIELDS.has(String(field)) ? String(field) : 'name'}`;
    if (sub === 'indexes' && typeof index === 'number') return `indexes.${index}.columnIds`;
    return null;
  },
  // Problems with this table's outgoing FKs belong to the referencing column's "References" field
  edge: (edge) => {
    if (edge.kind !== 'fk' || edge.source !== tableId) return null;
    const index = draft.columns.findIndex((c) => c.id === edge.data.sourceColumnId);
    return index >= 0 ? `columns.${index}.ref` : null;
  },
});

/** Choices for a column's "References" select: every column of every table, this draft included */
export function referenceOptions(doc: CanvasDoc, tableId: string, draft: TableDraft) {
  const options: { value: string; label: string }[] = [];
  for (const n of doc.nodes) {
    if (n.type !== 'table') continue;
    const [label, columns] = n.id === tableId ? [draft.label, draft.columns] : [n.label, n.data.columns];
    for (const c of columns) if (c.name.trim()) options.push({ value: refValue(n.id, c.id), label: `${label}.${c.name}` });
  }
  return options;
}
