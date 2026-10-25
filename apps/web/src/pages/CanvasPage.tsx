import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, getCanvas, getProject } from '../api/client';
import { Canvas } from '../canvas/Canvas';
import { DialogHost } from '../dialogs/DialogHost';
import { FeatureBar } from '../features/FeatureBar';
import { RecordingBar } from '../flows/RecordingBar';
import { useAutosave } from '../hooks/useAutosave';
import { Hint } from '../panels/Hint';
import { RightPanel } from '../panels/RightPanel';
import { SaveBanner } from '../panels/SaveBanner';
import { Toolbar } from '../panels/Toolbar';
import { TopBar } from '../panels/TopBar';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

type LoadResult = { projectId: string; error?: unknown };

/** Fetches the canvas once per project and loads it into canvasStore (ARCHITECTURE.md §8.1) */
function useCanvasLoader(projectId: string) {
  const [result, setResult] = useState<LoadResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCanvas(projectId).then(
      ({ doc, version }) => {
        if (cancelled) return;
        useCanvasStore.getState().load(doc, version, projectId);
        useUiStore.setState({
          selection: [],
          tool: 'select',
          hint: null,
          dialog: null,
          activeFlowId: null,
          flowRecording: false,
          playhead: null,
          viewFeatureId: null,
          contextMenu: null,
        });
        setResult({ projectId });
      },
      (error: unknown) => !cancelled && setResult({ projectId, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (result?.projectId !== projectId) return { status: 'loading' as const };
  return result.error ? { status: 'error' as const, error: result.error } : { status: 'ready' as const };
}

export function CanvasPage() {
  const { projectId = '' } = useParams();
  const canvas = useCanvasLoader(projectId);
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) });

  if (canvas.status === 'error') {
    const notFound = canvas.error instanceof ApiError && canvas.error.status === 404;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
        <p>{notFound ? 'This project does not exist or you have no access.' : 'Could not load the canvas.'}</p>
        <Link to="/" className="text-accent hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }
  if (canvas.status === 'loading') {
    return <div className="flex h-full items-center justify-center text-sm text-text-muted">Loading canvas…</div>;
  }
  return <Editor key={projectId} projectId={projectId} projectName={project.data?.name} />;
}

function Editor({ projectId, projectName }: { projectId: string; projectName?: string }) {
  useAutosave(projectId);

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <TopBar projectId={projectId} projectName={projectName} />
        <SaveBanner />
        <div className="flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1">
            <Toolbar />
            <Canvas />
            <RecordingBar />
            <FeatureBar />
            <Hint />
          </main>
          <RightPanel />
        </div>
      </div>
      <DialogHost />
    </ReactFlowProvider>
  );
}
