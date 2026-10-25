import { canvasToSvg, toCanvasJson } from '@flowcanvas/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getSnapshot } from '../api/client';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/form';
import { downloadText } from '../spec/download';
import { useCanvasStore } from '../store/canvasStore';
import { relativeTime, removeCheckpoint, restoreCheckpoint } from './snapshotActions';

/** A checkpoint: preview image (the canvas export renderer), what it holds, restore / download / delete */
export default function SnapshotDialog({ snapshotId, onClose }: { snapshotId: string; onClose(): void }) {
  const projectId = useCanvasStore((s) => s.projectId);
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: ['snapshot', projectId, snapshotId],
    queryFn: () => getSnapshot(projectId!, snapshotId),
    enabled: projectId !== null,
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = snapshot.data;
  const preview = useMemo(
    () => (data ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(canvasToSvg(data.doc, { theme: 'dark' }))}` : null),
    [data],
  );
  const title = data?.label ?? 'Checkpoint';

  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    if (await action()) onClose();
    else setBusy(false);
  };

  return (
    <Modal
      title={title}
      description={data ? `${relativeTime(data.createdAt)} · ${new Date(data.createdAt).toLocaleString()}${data.createdBy ? ` · ${data.createdBy}` : ''}` : undefined}
      width="max-w-4xl"
      onClose={onClose}
      footer={
        <>
          {confirmDelete ? (
            <span className="flex flex-1 items-center gap-2 text-xs">
              Delete this checkpoint?
              <Button className="px-2 py-1 text-xs" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
              <Button className="px-2 py-1 text-xs text-danger" disabled={busy} onClick={() => void run(() => removeCheckpoint(queryClient, snapshotId))}>
                Delete
              </Button>
            </span>
          ) : (
            <span className="flex flex-1 gap-2">
              <Button variant="ghost" className="px-2 py-1 text-xs" disabled={!data} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-3.5" /> Delete
              </Button>
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                disabled={!data}
                onClick={() => data && downloadText(toCanvasJson(data.doc), `checkpoint-${data.createdAt.slice(0, 10)}.json`, 'application/json')}
              >
                <Download className="size-3.5" /> Download JSON
              </Button>
            </span>
          )}
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!data || busy} onClick={() => void run(() => restoreCheckpoint(queryClient, snapshotId, data?.label ?? null))}>
            <RotateCcw className="size-3.5" /> Restore
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {snapshot.isError && <p className="text-danger">Could not load this checkpoint.</p>}
        {!data && !snapshot.isError && <p className="text-text-muted">Loading…</p>}
        {data && preview && (
          <>
            <p className="text-xs text-text-muted">
              {data.doc.nodes.length} nodes, {data.doc.edges.length} connections, {data.doc.flows.length} flows, {data.doc.models.length} API models.
              Restoring replaces the current canvas; it is saved as a checkpoint first, so you can go back.
            </p>
            <div className="max-h-[55vh] overflow-auto rounded-lg border border-border bg-canvas p-3">
              <img src={preview} alt="Checkpoint preview" className="mx-auto max-w-full" />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
