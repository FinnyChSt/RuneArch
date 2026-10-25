import { elementHandleId, elementIdOf } from '@flowcanvas/shared';

export type Side = 'l' | 'r';

/**
 * Per-column handles on table nodes: one per side, each usable as source and target.
 * FK edges don't store handles; the mapping picks the facing sides from table positions.
 */
export const columnHandleId = (columnId: string, side: Side) => `col:${columnId}:${side}`;

export const columnIdOf = (handleId: string | null | undefined): string | null =>
  handleId?.startsWith('col:') ? handleId.slice(4).replace(/:[lr]$/, '') : null;

/**
 * Per-side handles on the interactive elements of a screen's wireframe (source only). Link edges
 * store `el:<id>` without the side; the mapping picks the side facing the target.
 */
export const elementSideHandleId = (elementId: string, side: Side) => `${elementHandleId(elementId)}:${side}`;

/** The source handle a new link edge stores: element handles lose their side */
export function storedSourceHandle(handleId: string | null | undefined): string | undefined {
  const elementId = elementIdOf(handleId);
  return elementId !== null ? elementHandleId(elementId) : (handleId ?? undefined);
}
