import { featureById, featureDependencies, partName } from '@flowcanvas/shared';
import { queryClient } from '../app/queryClient';
import { saveCheckpoint } from '../history/snapshotActions';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

/*
 * Shipping and discarding a feature (docs/feature-scopes-plan.md §6). Both ask first; shipping
 * saves a checkpoint before it changes anything. Nothing blocks: unshipped dependencies are named
 * in the question, a failed checkpoint asks whether to go on (undo still works).
 */

const hint = (message: string) => useUiStore.getState().showHint(message);

export async function shipFeatureWithCheckpoint(featureId: string): Promise<boolean> {
  const { doc, projectId } = useCanvasStore.getState();
  const feature = featureById(doc, featureId);
  if (!feature) return false;
  const deps = featureDependencies(doc, featureId).map((d) => `• ${d.name}: ${d.items.map((r) => partName(doc, r)).join(', ')}`);
  const question = [
    `Ship "${feature.name}"?`,
    '',
    'What it adds and changes becomes the plain project, and what it removes is deleted for good. A checkpoint is saved first.',
    ...(deps.length ? ['', 'It relies on what these unshipped features add:', ...deps] : []),
  ].join('\n');
  if (!window.confirm(question)) return false;

  const saved = projectId ? await saveCheckpoint(queryClient, `Before shipping “${feature.name}”`) : false;
  if (!saved && !window.confirm('No checkpoint could be saved. Ship anyway? Undo still works until you reload.')) return false;

  const result = useCanvasStore.getState().shipFeature(featureId);
  if (!result.ok) hint(`Can't ship ${feature.name}: ${result.reason}`);
  else hint([`Shipped ${feature.name}`, ...result.warnings].join(' · '));
  return result.ok;
}

export function discardFeatureAfterAsking(featureId: string): boolean {
  const { doc } = useCanvasStore.getState();
  const feature = featureById(doc, featureId);
  if (!feature) return false;
  const question = `Discard "${feature.name}"?\n\nWhat it adds is deleted, what it changes goes back to how it was before, the parts it marks as removed stay, and the feature itself is deleted. Undo brings it all back.`;
  if (!window.confirm(question)) return false;
  const result = useCanvasStore.getState().discardFeature(featureId);
  if (!result.ok) hint(`Can't discard ${feature.name}: ${result.reason}`);
  else {
    if (useUiStore.getState().viewFeatureId === featureId) useUiStore.getState().selectFeature(null);
    hint(`Discarded ${feature.name}`);
  }
  return result.ok;
}
