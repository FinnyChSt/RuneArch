import { CRUD_OPS, kindForCrud, type CanvasDoc, type CanvasEdge, type CrudOp } from '@flowcanvas/shared';
import { replaceEdge } from '../store/docOps';
import type { IssueMapper } from './validation';

/*
 * Draft <-> edge conversions for the edge dialog. CRUD operations are checkboxes; on save they
 * are stored in CRUD order, and an edge into a table follows them: only `read` reads, anything else writes.
 */

export type LinkEdge = Exclude<CanvasEdge, { kind: 'fk' }>;

export type EdgeDraft = { label: string; crud: Record<CrudOp, boolean> };

export const toEdgeDraft = (edge: LinkEdge): EdgeDraft => ({
  label: edge.label ?? '',
  crud: Object.fromEntries(CRUD_OPS.map((op) => [op, edge.crud?.includes(op) ?? false])) as Record<CrudOp, boolean>,
});

export const fromEdgeDraft = (edge: LinkEdge, draft: EdgeDraft, intoTable: boolean): LinkEdge => {
  const crud = CRUD_OPS.filter((op) => draft.crud[op]);
  return {
    ...edge,
    label: draft.label.trim() || undefined,
    crud: crud.length ? crud : undefined,
    kind: intoTable && crud.length ? kindForCrud(crud) : edge.kind,
  };
};

export const edgeMapper: IssueMapper = {
  node: ([key]) => (key === 'label' ? 'label' : key === 'crud' ? 'crud' : null),
};

/** Candidate doc for the edge dialog */
export const withEdge = (edge: LinkEdge, intoTable: boolean) => (doc: CanvasDoc, draft: EdgeDraft) =>
  replaceEdge(doc, fromEdgeDraft(edge, draft, intoTable));
