import { emptyCanvas, type CanvasDoc } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { createNode } from '../store/nodeFactory';
import { createNodeMapper, toFlowEdges, type ViewState } from './mapping';

const view = (over: Partial<ViewState> = {}): ViewState => ({
  selection: new Set(),
  invalid: new Set(),
  measured: {},
  dragPositions: {},
  ...over,
});

function makeDoc() {
  const empty = emptyCanvas();
  const a = createNode(empty, 'screen', { x: 0, y: 0 });
  const b = createNode(empty, 'endpoint', { x: 200, y: 0 });
  const edge = { id: 'e1', kind: 'calls', source: a.id, target: b.id, sourceHandle: 'r' } as const;
  const doc: CanvasDoc = { ...empty, nodes: [a, b], edges: [edge] };
  return { doc, a, b, edge };
}

describe('mapping', () => {
  it('maps doc nodes with view state', () => {
    const { doc, a, b } = makeDoc();
    const nodes = createNodeMapper()(
      doc,
      view({
        selection: new Set([b.id]),
        measured: { [a.id]: { width: 180, height: 60 } },
        dragPositions: { [b.id]: { x: 5, y: 5 } },
      }),
    );
    expect(nodes[0]).toMatchObject({ id: a.id, type: 'screen', position: { x: 0, y: 0 }, selected: false, data: { node: a } });
    expect(nodes[0]?.measured).toEqual({ width: 180, height: 60 });
    expect(nodes[1]).toMatchObject({ id: b.id, position: { x: 5, y: 5 }, selected: true });
  });

  it('reuses node objects that did not change', () => {
    const { doc, b } = makeDoc();
    const map = createNodeMapper();
    const first = map(doc, view());
    const second = map(doc, view({ selection: new Set([b.id]) }));
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  it('maps edges', () => {
    const { doc, edge } = makeDoc();
    const [mapped] = toFlowEdges(doc, view({ selection: new Set(['e1']) }));
    expect(mapped).toMatchObject({ id: 'e1', type: 'link', sourceHandle: 'r', targetHandle: null, selected: true });
    expect(mapped?.data?.edge).toBe(edge);
    expect(mapped?.data?.pair).toBeUndefined();
  });

  it('marks two-way pairs with opposite sides', () => {
    const { doc, a, b } = makeDoc();
    const back = { id: 'e2', kind: 'reads', source: b.id, target: a.id } as const;
    const [forward, reverse] = toFlowEdges({ ...doc, edges: [...doc.edges, back] }, view());
    expect(forward?.data?.pair).toBeDefined();
    expect(reverse?.data?.pair).toBe(-forward!.data!.pair!);
  });
});

describe('foreign keys', () => {
  it('derives FK edge handles from column ids and flags FK columns on tables', async () => {
    const { shopDoc } = await import('../test/fixtures');
    const doc = shopDoc();
    // orders (source) sits right of users (target): leave orders on its left, enter users on its right
    const fk = toFlowEdges(doc, view()).find((e) => e.id === 'fk');
    expect(fk).toMatchObject({ type: 'fk', sourceHandle: 'col:o_user:l', targetHandle: 'col:u_id:r' });

    // Dragging orders to the other side flips the ends
    const dragged = toFlowEdges(doc, view({ dragPositions: { orders: { x: -600, y: 0 } } })).find((e) => e.id === 'fk');
    expect(dragged).toMatchObject({ sourceHandle: 'col:o_user:r', targetHandle: 'col:u_id:l' });

    const nodes = createNodeMapper()(doc, view());
    expect(nodes.find((n) => n.id === 'orders')?.data.fkColumnIds).toEqual(['o_user']);
    expect(nodes.find((n) => n.id === 'users')?.data.fkColumnIds).toEqual([]);
  });
});
