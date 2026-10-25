import type { QueryClient } from '@tanstack/react-query';
import { ApiError, createSnapshot, deleteSnapshot, restoreSnapshot } from '../api/client';
import { saveNow } from '../store/autosaver';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

/*
 * Snapshot commands shared by the History panel and the snapshot dialog. Both first save pending
 * changes (saveNow), so a checkpoint holds what the user sees and a restore checkpoints it.
 */

export const snapshotsKey = (projectId: string) => ['snapshots', projectId] as const;

const hint = (message: string) => useUiStore.getState().showHint(message);

/** Why a snapshot request failed, in words */
function failure(error: unknown, action: string): string {
  if (error instanceof ApiError && error.status === 403) return `Only editors can ${action}`;
  if (error instanceof ApiError && error.status === 404) return 'That checkpoint no longer exists';
  return `Could not ${action}; check the connection and try again`;
}

async function savedFirst(action: string): Promise<boolean> {
  if (await saveNow()) return true;
  hint(`Could not ${action}: the canvas has unsaved changes that failed to save`);
  return false;
}

export async function saveCheckpoint(queryClient: QueryClient, label: string): Promise<boolean> {
  const { projectId } = useCanvasStore.getState();
  if (!projectId || !(await savedFirst('save a checkpoint'))) return false;
  try {
    await createSnapshot(projectId, label);
    await queryClient.invalidateQueries({ queryKey: snapshotsKey(projectId) });
    hint('Checkpoint saved');
    return true;
  } catch (error) {
    hint(failure(error, 'save a checkpoint'));
    return false;
  }
}

/** Restores a checkpoint; the canvas it replaces is kept as a checkpoint (restore that one to undo) */
export async function restoreCheckpoint(queryClient: QueryClient, snapshotId: string, label: string | null): Promise<boolean> {
  const { projectId } = useCanvasStore.getState();
  if (!projectId || !(await savedFirst('restore'))) return false;
  try {
    const { doc, version } = await restoreSnapshot(projectId, snapshotId);
    useCanvasStore.getState().load(doc, version, projectId);
    const ui = useUiStore.getState();
    ui.setSelection([]);
    ui.selectFlow(null);
    ui.requestFit();
    await queryClient.invalidateQueries({ queryKey: snapshotsKey(projectId) });
    hint(`Restored ${label ? `“${label}”` : 'the checkpoint'}. The previous canvas was saved as a checkpoint`);
    return true;
  } catch (error) {
    hint(failure(error, 'restore'));
    return false;
  }
}

export async function removeCheckpoint(queryClient: QueryClient, snapshotId: string): Promise<boolean> {
  const { projectId } = useCanvasStore.getState();
  if (!projectId) return false;
  try {
    await deleteSnapshot(projectId, snapshotId);
    await queryClient.invalidateQueries({ queryKey: snapshotsKey(projectId) });
    return true;
  } catch (error) {
    hint(failure(error, 'delete the checkpoint'));
    return false;
  }
}

/** "just now", "5 min ago", "3 h ago", "yesterday", else a date */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso);
  const minutes = Math.round((now - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'yesterday';
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
