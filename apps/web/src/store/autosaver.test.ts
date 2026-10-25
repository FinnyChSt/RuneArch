import { emptyCanvas, type SaveCanvas } from '@flowcanvas/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveOutcome } from '../api/client';
import { saveNow, startAutosave } from './autosaver';
import { undo, useCanvasStore } from './canvasStore';

const store = () => useCanvasStore.getState();

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let calls: { projectId: string; body: SaveCanvas; result: ReturnType<typeof deferred<SaveOutcome>> }[];
let autosave: ReturnType<typeof startAutosave>;

const save = (projectId: string, body: SaveCanvas) => {
  const result = deferred<SaveOutcome>();
  calls.push({ projectId, body, result });
  return result.promise;
};

/** Resolves the latest request and lets the autosaver process it */
const respond = async (outcome: SaveOutcome) => {
  calls.at(-1)!.result.resolve(outcome);
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  store().load(emptyCanvas(), 1, 'p1');
  autosave = startAutosave({ save, delay: 1500, retryDelay: () => 5000 });
});

afterEach(() => {
  autosave.stop();
  vi.useRealTimers();
});

describe('autosave', () => {
  it('does nothing while saved; view-only changes do not dirty the doc', async () => {
    store().setViewport({ x: 10, y: 10, zoom: 2 });
    store().applyNodeChanges([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(store().saveState).toBe('saved');
    expect(calls).toHaveLength(0);
  });

  it('debounces edits into one save with the latest doc, version and viewport', async () => {
    store().addNode('screen', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    store().addNode('table', { x: 0, y: 0 });
    store().setViewport({ x: 5, y: 6, zoom: 0.5 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.projectId).toBe('p1');
    expect(calls[0]!.body.version).toBe(1);
    expect(calls[0]!.body.doc.nodes).toHaveLength(2);
    expect(calls[0]!.body.doc.viewport).toEqual({ x: 5, y: 6, zoom: 0.5 });
    expect(store().saveState).toBe('saving');

    await respond({ type: 'saved', version: 2 });
    expect(store()).toMatchObject({ saveState: 'saved', version: 2 });
  });

  it('keeps one request in flight and resaves edits made meanwhile', async () => {
    store().addNode('screen', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1500);
    store().addNode('table', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);

    await respond({ type: 'saved', version: 2 });
    expect(store()).toMatchObject({ saveState: 'dirty', version: 2 });

    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.version).toBe(2);
    expect(calls[1]!.body.doc.nodes).toHaveLength(2);
  });

  it('marks undo and redo as changes', async () => {
    store().addNode('screen', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1500);
    await respond({ type: 'saved', version: 2 });
    undo();
    expect(store().saveState).toBe('dirty');
  });

  it('pauses on conflict, including for later edits', async () => {
    store().addNode('screen', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1500);
    await respond({ type: 'conflict', currentVersion: 5 });
    expect(store()).toMatchObject({ saveState: 'conflict', conflictVersion: 5 });

    store().addNode('table', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store().saveState).toBe('conflict');
    expect(calls).toHaveLength(1);
  });

  it('overwrite after a conflict saves against the new version', async () => {
    store().addNode('screen', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1500);
    await respond({ type: 'conflict', currentVersion: 5 });

    useCanvasStore.setState({ version: 5, conflictVersion: null, saveState: 'dirty' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls[1]!.body.version).toBe(5);
  });

  it('flags invalid nodes and retries once the doc changes', async () => {
    const id = store().addNode('screen', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1500);
    await respond({ type: 'invalid', issues: [{ path: ['doc', 'nodes', 0, 'label'], message: 'Bad label' }] });
    expect(store()).toMatchObject({
      saveState: 'error',
      saveError: { kind: 'invalid', issues: [{ message: 'Bad label' }] },
      invalidIds: [id],
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);

    store().updateNode(id, { label: 'Fixed' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(2);
    await respond({ type: 'saved', version: 2 });
    expect(store()).toMatchObject({ saveState: 'saved', saveError: null, invalidIds: [] });
  });

  it('retries after network errors', async () => {
    store().addNode('screen', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1500);
    calls[0]!.result.reject(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(0);
    expect(store()).toMatchObject({ saveState: 'error', saveError: { kind: 'network' } });

    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.version).toBe(1);
  });

  it('flushes pending changes immediately on stop', async () => {
    store().addNode('screen', { x: 0, y: 0 });
    autosave.stop();
    expect(calls).toHaveLength(1);
  });

  it('ignores a response for a project that is no longer loaded', async () => {
    store().addNode('screen', { x: 0, y: 0 });
    await vi.advanceTimersByTimeAsync(1500);
    store().load(emptyCanvas(), 7, 'p2');
    await respond({ type: 'saved', version: 2 });
    expect(store()).toMatchObject({ projectId: 'p2', version: 7, saveState: 'saved' });
  });
});

describe('saveNow', () => {
  it('saves pending changes right away and resolves once saved', async () => {
    store().addNode('screen', { x: 0, y: 0 });
    const done = saveNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1); // no 1.5 s debounce
    await respond({ type: 'saved', version: 2 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(done).resolves.toBe(true);
    expect(store().saveState).toBe('saved');
  });

  it('resolves at once when nothing is pending, and false when the save fails', async () => {
    await expect(saveNow()).resolves.toBe(true);
    store().addNode('screen', { x: 0, y: 0 });
    const done = saveNow();
    await vi.advanceTimersByTimeAsync(0);
    await respond({ type: 'conflict', currentVersion: 5 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(done).resolves.toBe(false);
  });
});
