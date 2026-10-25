import type { CanvasDoc, SaveCanvas, ValidationIssue } from '@flowcanvas/shared';
import type { SaveOutcome } from '../api/client';
import { useCanvasStore } from './canvasStore';

export type AutosaveDeps = {
  save(projectId: string, body: SaveCanvas): Promise<SaveOutcome>;
  /** Debounce after the last change (ms) */
  delay?: number;
  /** Retry delay after a network failure, per attempt (ms) */
  retryDelay?: (attempt: number) => number;
};

const defaultRetryDelay = (attempt: number) => Math.min(30_000, 2_000 * 2 ** attempt);

/** The body a save sends: the doc plus the live viewport */
export function saveBody(): SaveCanvas {
  const { doc, viewport, version } = useCanvasStore.getState();
  return { doc: { ...doc, viewport }, version };
}

/** Node ids referenced by issue paths like ['doc', 'nodes', 3, ...] in the doc that was sent */
function invalidNodeIds(doc: CanvasDoc, issues: ValidationIssue[]): string[] {
  const ids = issues.flatMap(({ path }) => {
    const i = path[0] === 'doc' && path[1] === 'nodes' ? path[2] : undefined;
    const node = typeof i === 'number' ? doc.nodes[i] : undefined;
    return node ? [node.id] : [];
  });
  return [...new Set(ids)];
}

/** The running autosaver (one canvas is open at a time), for saveNow */
let active: { flush(): Promise<void> } | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Saves pending changes now and resolves once the canvas is saved: true, or false if the save
 * ended in a conflict or an error (or took too long). Checkpoints and restores wait for it, so they
 * work on what the user sees.
 */
export async function saveNow(timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { saveState } = useCanvasStore.getState();
    if (saveState === 'saved') return true;
    if (saveState === 'conflict' || saveState === 'error' || !active) return false;
    if (saveState === 'dirty') await active.flush();
    // A request in flight (or a flush that found one) finishes on its own
    await sleep(25);
  }
  return false;
}

/**
 * Saves canvasStore.doc whenever it is dirty (ARCHITECTURE.md §7 Autosave):
 * debounce, one request at a time, resave if edited meanwhile, pause on 409, retry network errors.
 * Returns `flush` (save now) and `stop` (unsubscribe, flushing pending changes).
 */
export function startAutosave({ save, delay = 1500, retryDelay = defaultRetryDelay }: AutosaveDeps) {
  const store = useCanvasStore;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let attempt = 0;
  let stopped = false;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };

  async function flush() {
    clearTimeout(timer);
    const state = store.getState();
    if (inFlight || state.saveState !== 'dirty' || !state.projectId) return;

    const { projectId } = state;
    const body = saveBody();
    const sentDoc = state.doc;
    inFlight = true;
    store.setState({ saveState: 'saving' });

    try {
      const outcome = await save(projectId, body);
      if (store.getState().projectId !== projectId) return; // another project was loaded meanwhile
      attempt = 0;

      if (outcome.type === 'saved') {
        store.setState((s) => ({
          version: outcome.version,
          // Edits made during the request keep the doc dirty (and scheduled below)
          saveState: s.doc === sentDoc ? 'saved' : 'dirty',
          saveError: null,
          invalidIds: [],
        }));
      } else if (outcome.type === 'conflict') {
        store.setState({ saveState: 'conflict', conflictVersion: outcome.currentVersion });
      } else {
        store.setState({
          saveState: 'error',
          saveError: { kind: 'invalid', issues: outcome.issues },
          invalidIds: invalidNodeIds(body.doc, outcome.issues),
        });
      }
    } catch {
      if (store.getState().projectId !== projectId) return;
      store.setState({ saveState: 'error', saveError: { kind: 'network' } });
      if (!stopped) {
        timer = setTimeout(() => {
          if (store.getState().saveState !== 'error') return;
          store.setState({ saveState: 'dirty' });
          void flush();
        }, retryDelay(attempt++));
      }
    } finally {
      inFlight = false;
    }

    if (store.getState().saveState !== 'dirty') return;
    if (stopped) void flush();
    else schedule(delay);
  }

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.saveState === 'dirty' && (prev.saveState !== 'dirty' || s.doc !== prev.doc)) schedule(delay);
  });

  const autosave = {
    flush,
    stop() {
      stopped = true;
      unsubscribe();
      if (active === autosave) active = null;
      void flush();
    },
  };
  active = autosave;
  return autosave;
}
