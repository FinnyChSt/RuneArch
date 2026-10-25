import { applyScope, featureById, type CanvasDoc, type ExportScope, type ScopedDoc } from '@flowcanvas/shared';
import { useMemo, useState } from 'react';
import { STATUS_LABEL } from '../canvas/featureView';
import { checkboxClass, compactControlClass } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

/** What a project export covers: '' = the whole project, else one feature */
export type Scope = { featureId: string; unshipped: 'include' | 'exclude' };

/** Starts at the highlighted feature (or the one being worked on), else the whole project */
export function useExportScope() {
  return useState<Scope>(() => {
    const featureId = useUiStore.getState().viewFeatureId ?? useCanvasStore.getState().activeFeatureId ?? '';
    return { featureId, unshipped: 'include' };
  });
}

export const toExportScope = (scope: Scope): ExportScope =>
  scope.featureId ? { featureId: scope.featureId } : { unshipped: scope.unshipped };

/** The scope as live-URL query params: `feature=<id>` or `unshipped=exclude` */
export const scopeParams = (scope: Scope): Record<string, string> =>
  scope.featureId ? { feature: scope.featureId } : scope.unshipped === 'exclude' ? { unshipped: 'exclude' } : {};

/** The doc the scope renders (a scope naming a deleted feature falls back to the whole project) */
export function useScopedDoc(doc: CanvasDoc, scope: Scope): ScopedDoc & { featureId?: string } {
  return useMemo(() => {
    const scoped = applyScope(doc, toExportScope(scope));
    return scoped ? { ...scoped, featureId: scope.featureId || undefined } : { doc };
  }, [doc, scope]);
}

/** Whole project or one feature; for the whole project, whether to leave out what unshipped features add */
export function ScopePicker({ scope, onChange }: { scope: Scope; onChange(scope: Scope): void }) {
  const features = useCanvasStore((s) => s.doc.features);
  if (features.length === 0) return null;
  const unknown = scope.featureId && !features.some((f) => f.id === scope.featureId);
  return (
    <>
      <select
        aria-label="Scope"
        value={unknown ? '' : scope.featureId}
        onChange={(e) => onChange({ ...scope, featureId: e.target.value })}
        className={`${compactControlClass} w-60`}
      >
        <option value="">Whole project</option>
        {features.map((f) => (
          <option key={f.id} value={f.id}>
            Feature: {f.name} ({STATUS_LABEL[f.status].toLowerCase()})
          </option>
        ))}
      </select>
      {!scope.featureId && (
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={scope.unshipped === 'exclude'}
            onChange={(e) => onChange({ ...scope, unshipped: e.target.checked ? 'exclude' : 'include' })}
          />
          Leave out unshipped additions
        </label>
      )}
    </>
  );
}

/** "Wishlist" for file names and headings, or undefined for the whole project */
export const scopeFeatureName = (doc: CanvasDoc, scope: Scope) => (scope.featureId ? featureById(doc, scope.featureId)?.name : undefined);
