import { CanvasDoc, emptyCanvas } from '@flowcanvas/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { redo, undo, useCanvasStore } from './canvasStore';
import { CREATABLE_NODE_TYPES, SKETCH_SHAPES } from './nodeFactory';

const store = () => useCanvasStore.getState();
const history = () => useCanvasStore.temporal.getState();
const expectValid = () => expect(() => CanvasDoc.parse(store().doc)).not.toThrow();

beforeEach(() => store().load(emptyCanvas(), 0));

describe('canvasStore', () => {
  it('adds valid nodes of every creatable type and sketch shape (frames first)', () => {
    for (const type of [...CREATABLE_NODE_TYPES, ...SKETCH_SHAPES]) store().addNode(type, { x: 0, y: 0 });
    expect(store().doc.nodes.map((n) => (n.type === 'sketch' ? n.data.shape : n.type))).toEqual([
      'frame',
      'screen',
      'component',
      'endpoint',
      'service',
      'job',
      'table',
      'rect',
      'ellipse',
      'text',
      'sticky',
    ]);
    expect(store().saveState).toBe('dirty');
    expectValid();
  });

  it('keeps endpoint routes unique', () => {
    store().addNode('endpoint', { x: 0, y: 0 });
    store().addNode('endpoint', { x: 0, y: 0 });
    const [a, b] = store().doc.nodes.map((n) => (n.type === 'endpoint' ? n.data.path : ''));
    expect(a).not.toBe(b);
    expectValid();
  });

  it('connects nodes with the inferred kind and rejects invalid connections', () => {
    const screen = store().addNode('screen', { x: 0, y: 0 });
    const endpoint = store().addNode('endpoint', { x: 200, y: 0 });
    const t1 = store().addNode('table', { x: 0, y: 200 });
    const t2 = store().addNode('table', { x: 200, y: 200 });

    expect(store().connect({ source: screen, target: endpoint })).toEqual({ ok: true, kind: 'calls' });
    expect(store().connect({ source: t1, target: t2 }).ok).toBe(false);
    expect(store().doc.edges).toHaveLength(1);
    expectValid();
  });

  it('removing a node removes its edges and prunes flows', () => {
    const a = store().addNode('screen', { x: 0, y: 0 });
    const b = store().addNode('endpoint', { x: 0, y: 0 });
    const c = store().addNode('table', { x: 0, y: 0 });
    store().connect({ source: a, target: b });
    store().connect({ source: b, target: c });
    const [e1, e2] = store().doc.edges.map((e) => e.id) as [string, string];
    useCanvasStore.setState((s) => ({
      doc: { ...s.doc, flows: [{ id: 'f', name: 'Flow', steps: [{ edgeId: e1 }, { edgeId: e2 }] }] },
    }));

    store().removeElements([c]);
    expect(store().doc.edges.map((e) => e.id)).toEqual([e1]);
    expect(store().doc.flows[0]!.steps).toEqual([{ edgeId: e1 }]);

    store().removeElements([a]);
    expect(store().doc.edges).toEqual([]);
    // The flow stays (now empty) so it can be re-recorded
    expect(store().doc.flows).toEqual([{ id: 'f', name: 'Flow', steps: [] }]);
    expectValid();
  });

  it('records a whole drag as one undo step and ignores measurements', () => {
    const id = store().addNode('screen', { x: 0, y: 0 });
    const steps = history().pastStates.length;

    store().applyNodeChanges([{ type: 'dimensions', id, dimensions: { width: 180, height: 60 } }]);
    for (const x of [10, 20, 30]) store().applyNodeChanges([{ type: 'position', id, position: { x, y: 0 }, dragging: true }]);
    expect(store().doc.nodes[0]!.position).toEqual({ x: 0, y: 0 });
    expect(store().dragPositions[id]).toEqual({ x: 30, y: 0 });

    store().applyNodeChanges([{ type: 'position', id, position: { x: 40, y: 5 }, dragging: false }]);
    expect(store().doc.nodes[0]!.position).toEqual({ x: 40, y: 5 });
    expect(store().dragPositions).toEqual({});
    expect(history().pastStates.length).toBe(steps + 1);

    undo();
    expect(store().doc.nodes[0]!.position).toEqual({ x: 0, y: 0 });
    redo();
    expect(store().doc.nodes[0]!.position).toEqual({ x: 40, y: 5 });
  });

  it('undo and redo restore the document', () => {
    store().addNode('screen', { x: 0, y: 0 });
    store().addNode('table', { x: 0, y: 0 });
    undo();
    expect(store().doc.nodes).toHaveLength(1);
    undo();
    expect(store().doc.nodes).toHaveLength(0);
    redo();
    redo();
    expect(store().doc.nodes).toHaveLength(2);
  });

  it('load clears history', () => {
    store().addNode('screen', { x: 0, y: 0 });
    store().load(emptyCanvas(), 3);
    expect(history().pastStates).toHaveLength(0);
    expect(store().saveState).toBe('saved');
  });

  it('duplicates nodes and the edges between them with fresh ids', () => {
    const a = store().addNode('screen', { x: 0, y: 0 });
    const b = store().addNode('endpoint', { x: 100, y: 0 });
    store().connect({ source: a, target: b });

    const copies = store().duplicate([a, b]);
    expect(copies).toHaveLength(3);
    expect(store().doc.nodes).toHaveLength(4);
    expect(store().doc.edges).toHaveLength(2);
    expect(store().doc.nodes[2]!.position).toEqual({ x: 32, y: 32 });
    expectValid();
  });

  it('updateNode validates the patch through the shared schema', () => {
    const id = store().addNode('screen', { x: 0, y: 0 });
    store().updateNode(id, { label: 'Checkout' });
    expect(store().doc.nodes[0]!.label).toBe('Checkout');
    expect(() => store().updateNode(id, { position: { x: 'bad' } } as never)).toThrow();
  });

  describe('frames, sketches and arranging', () => {
    const pos = (id: string) => store().doc.nodes.find((n) => n.id === id)!;
    const setup = () => {
      const frame = store().addNode('frame', { x: 100, y: 100 }); // 480 x 320
      const note = store().addNode('sticky', { x: 700, y: 100 }); // 180 x 160, outside
      history().clear();
      return { frame, note };
    };

    it('a node dropped into a frame joins it (relative position); dragging it out leaves', () => {
      const { frame, note } = setup();
      store().applyNodeChanges([{ id: note, type: 'position', position: { x: 150, y: 150 }, dragging: false }]);
      expect(pos(note)).toMatchObject({ parentId: frame, position: { x: 50, y: 50 } });
      store().applyNodeChanges([{ id: note, type: 'position', position: { x: 800, y: 0 }, dragging: false }]);
      expect(pos(note)).toMatchObject({ parentId: undefined, position: { x: 900, y: 100 } });
      expect(history().pastStates).toHaveLength(2);
      expectValid();
    });

    it('a resize is one undo step, with the positions it moved', () => {
      const { frame } = setup();
      const dims = (resizing: boolean, width: number) =>
        ({ id: frame, type: 'dimensions', resizing, dimensions: { width, height: 300 } }) as const;
      store().applyNodeChanges([dims(true, 500), { id: frame, type: 'position', position: { x: 80, y: 100 } }]);
      store().applyNodeChanges([dims(true, 520), { id: frame, type: 'position', position: { x: 60, y: 100 } }]);
      expect(pos(frame).size).toEqual({ width: 480, height: 320 });
      expect(store().resizeSizes[frame]).toEqual({ width: 520, height: 300 });
      store().applyNodeChanges([dims(false, 520)]);
      expect(pos(frame)).toMatchObject({ size: { width: 520, height: 300 }, position: { x: 60, y: 100 } });
      expect(store().resizeSizes).toEqual({});
      expect(history().pastStates).toHaveLength(1);
    });

    it('groups nodes into a frame and ungroups them in place', () => {
      const a = store().addNode('rect', { x: 0, y: 0 });
      const b = store().addNode('rect', { x: 300, y: 200 });
      const frame = store().group([a, b])!;
      expect(pos(frame)).toMatchObject({ type: 'frame', position: { x: -32, y: -48 }, size: { width: 524, height: 380 } });
      expect(pos(b)).toMatchObject({ parentId: frame, position: { x: 332, y: 248 } });
      expectValid();
      store().ungroup([frame]);
      expect(pos(b)).toMatchObject({ parentId: undefined, position: { x: 300, y: 200 } });
      expect(store().doc.nodes.some((n) => n.id === frame)).toBe(false);
    });

    it('arranges by absolute position, keeping children in their frame', () => {
      const { frame, note } = setup();
      store().applyNodeChanges([{ id: note, type: 'position', position: { x: 150, y: 150 }, dragging: false }]);
      store().arrange({ [note]: { x: 120, y: 400 } });
      expect(pos(note)).toMatchObject({ parentId: frame, position: { x: 20, y: 300 } });
    });

    it('draws an arrow between any two nodes with the arrow option', () => {
      const t1 = store().addNode('table', { x: 0, y: 0 });
      const t2 = store().addNode('table', { x: 400, y: 0 });
      expect(store().connect({ source: t1, target: t2 }).ok).toBe(false);
      expect(store().connect({ source: t1, target: t2 }, { arrow: true })).toEqual({ ok: true, kind: 'arrow' });
      expect(store().connect({ source: t1, target: t2 }, { arrow: true }).ok).toBe(false);
      const frame = store().addNode('frame', { x: 0, y: 400 });
      expect(store().connect({ source: t1, target: frame }, { arrow: true }).ok).toBe(false);
      expectValid();
    });

    it('adds pen strokes relative to their top-left', () => {
      const id = store().addStroke([
        [10, 20, 0.5],
        [30, 60, 0.5],
      ]);
      expect(pos(id)).toMatchObject({ position: { x: 2, y: 12 }, size: { width: 36, height: 56 } });
      expect(pos(id).type === 'sketch' && pos(id).data).toMatchObject({ shape: 'freehand', points: [[8, 8, 0.5], [28, 48, 0.5]] });
    });

    it('deleting a frame keeps its children where they are; duplicating copies them inside the copy', () => {
      const { frame, note } = setup();
      store().applyNodeChanges([{ id: note, type: 'position', position: { x: 150, y: 150 }, dragging: false }]);
      const copies = store().duplicate([frame, note]);
      const copiedNote = pos(copies[1]!);
      expect(copiedNote).toMatchObject({ parentId: copies[0], position: { x: 50, y: 50 } });
      store().removeElements([frame]);
      expect(pos(note)).toMatchObject({ parentId: undefined, position: { x: 150, y: 150 } });
      expectValid();
    });
  });
});
