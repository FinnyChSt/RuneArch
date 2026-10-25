import { useEffect } from 'react';
import { getCanvas, saveCanvas, saveCanvasOnUnload } from '../api/client';
import { saveBody, startAutosave } from '../store/autosaver';
import { useCanvasStore } from '../store/canvasStore';

/** Runs autosave while a project's canvas is open */
export function useAutosave(projectId: string) {
  useEffect(() => {
    const autosave = startAutosave({ save: saveCanvas });

    // Ask before leaving with unsaved work...
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useCanvasStore.getState().saveState !== 'saved') e.preventDefault();
    };
    // ...and once the page is really going away, try one last save
    const onPageHide = () => {
      const s = useCanvasStore.getState();
      if (s.saveState === 'dirty' && s.projectId) saveCanvasOnUnload(s.projectId, saveBody());
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      autosave.stop();
    };
  }, [projectId]);
}

/** Conflict: drop local changes and load the latest server doc */
export async function reloadLatest() {
  const { projectId } = useCanvasStore.getState();
  if (!projectId) return;
  const { doc, version } = await getCanvas(projectId);
  useCanvasStore.getState().load(doc, version, projectId);
}

/** Conflict: keep local changes and save them over the latest server version */
export async function overwriteLatest() {
  const { projectId } = useCanvasStore.getState();
  if (!projectId) return;
  const { version } = await getCanvas(projectId);
  useCanvasStore.setState({ version, conflictVersion: null, saveState: 'dirty' });
}
