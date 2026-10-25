import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { listSnapshots } from '../api/client';
import { Button, controlClass } from '../components/ui/form';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { relativeTime, saveCheckpoint, snapshotsKey } from './snapshotActions';

/** Right panel "History" tab: save a named checkpoint, list them, open one to preview or restore */
export function HistoryPanel() {
  const projectId = useCanvasStore((s) => s.projectId);
  const queryClient = useQueryClient();
  const snapshots = useQuery({
    queryKey: snapshotsKey(projectId ?? ''),
    queryFn: () => listSnapshots(projectId!),
    enabled: projectId !== null,
  });
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (await saveCheckpoint(queryClient, label)) setLabel('');
    setSaving(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={(e) => void submit(e)} className="grid gap-2 border-b border-border p-3">
        <input
          aria-label="Checkpoint name"
          value={label}
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name, e.g. Before the refactor"
          className={`${controlClass} text-xs`}
        />
        <Button type="submit" variant="primary" disabled={saving} className="justify-center px-2 py-1 text-xs">
          <Save className="size-3.5" /> Save checkpoint
        </Button>
      </form>

      {snapshots.isPending && projectId && <p className="px-4 py-3 text-xs text-text-muted">Loading…</p>}
      {snapshots.isError && <p className="px-4 py-3 text-xs text-danger">Could not load checkpoints.</p>}
      {snapshots.data?.length === 0 && (
        <p className="px-4 py-3 text-text-muted">
          No checkpoints yet. Save one before a big change; restoring always keeps the current canvas as a checkpoint too.
        </p>
      )}
      <ul aria-label="Checkpoints" className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {snapshots.data?.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => useUiStore.getState().openDialog({ kind: 'snapshot', id: s.id })}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-raised"
            >
              <History className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${s.label ? '' : 'text-text-muted italic'}`}>{s.label ?? 'Checkpoint'}</span>
                <span className="block text-xs text-text-muted" title={new Date(s.createdAt).toLocaleString()}>
                  {relativeTime(s.createdAt)}
                  {s.createdBy && ` · ${s.createdBy}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
