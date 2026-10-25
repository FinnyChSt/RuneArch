import { BadRequestException, NotFoundException } from '@nestjs/common';
import { applyScope, featureById, type CanvasDoc, type ExportScope, type ScopedDoc } from '@flowcanvas/shared';

/** `?feature=<id>&unshipped=include|exclude` as an export scope; 400 for a bad value, 404 for an unknown feature */
export function exportScope(doc: CanvasDoc, featureId: string | undefined, unshipped: string | undefined): ExportScope {
  if (unshipped !== undefined && unshipped !== 'include' && unshipped !== 'exclude')
    throw new BadRequestException(`unshipped must be include or exclude, not ${unshipped}`);
  if (featureId !== undefined && !featureById(doc, featureId)) throw new NotFoundException(`Unknown feature: ${featureId}`);
  return { featureId, unshipped };
}

/** The doc an export renders for the query, with the feature's roles when it is scoped to one */
export function scopedDoc(doc: CanvasDoc, featureId: string | undefined, unshipped: string | undefined): ScopedDoc {
  return applyScope(doc, exportScope(doc, featureId, unshipped))!;
}
