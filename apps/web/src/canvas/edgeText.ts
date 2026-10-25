import type { CanvasEdge, CrudOp } from '@flowcanvas/shared';

/** "create · update" */
export const crudText = (ops: readonly CrudOp[]) => ops.join(' · ');

/** What an edge does, for lists: its CRUD operations when set, otherwise its kind */
export const edgeCaption = (edge: CanvasEdge) => (edge.kind !== 'fk' && edge.crud?.length ? crudText(edge.crud) : edge.kind);
