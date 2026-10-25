import { CanvasDoc } from '@flowcanvas/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkoutDoc } from '../test/fixtures';
import { undo, useCanvasStore } from './canvasStore';

const store = () => useCanvasStore.getState();
const history = () => useCanvasStore.temporal.getState().pastStates.length;
const flow = (id: string) => store().doc.flows.find((f) => f.id === id);

beforeEach(() => store().load(checkoutDoc(), 1, 'p1'));

describe('flow actions', () => {
  it('creates an empty flow, then records steps one undo step at a time', () => {
    const id = store().addFlow({ name: ' Checkout ', color: 'teal' });
    expect(flow(id)).toMatchObject({ name: 'Checkout', color: 'teal', steps: [] });
    expect(() => CanvasDoc.parse(store().doc)).not.toThrow();

    expect(store().addFlowStep(id, 'e1')).toEqual({ ok: true });
    expect(store().addFlowStep(id, 'e2')).toEqual({ ok: true });
    expect(store().addFlowStep(id, 'e3')).toEqual({ ok: true }); // branch from POST /orders
    expect(flow(id)!.steps.map((s) => s.edgeId)).toEqual(['e1', 'e2', 'e3']);
    expect(history()).toBe(4);
    expect(store().saveState).toBe('dirty');

    undo();
    expect(flow(id)!.steps.map((s) => s.edgeId)).toEqual(['e1', 'e2']);
  });

  it('rejects steps that do not continue the flow, or repeat an edge', () => {
    const id = store().addFlow({ name: 'Checkout' });
    store().addFlowStep(id, 'e1');
    expect(store().addFlowStep(id, 'e4')).toEqual({
      ok: false,
      reason: 'Step does not continue from a node already in the flow',
    });
    expect(store().addFlowStep(id, 'e1')).toMatchObject({ ok: false });
    expect(store().addFlowStep('nope', 'e1')).toMatchObject({ ok: false });
    expect(flow(id)!.steps).toHaveLength(1);
  });

  it('saves and removes flows', () => {
    const id = store().addFlow({ name: 'Checkout' });
    store().saveFlow({ ...flow(id)!, name: 'Buy', description: 'Happy path' });
    expect(flow(id)).toMatchObject({ name: 'Buy', description: 'Happy path' });
    store().removeFlow(id);
    expect(store().doc.flows).toEqual([]);
  });

  it('deleting a node keeps the flow and drops only the steps that no longer continue', () => {
    const id = store().addFlow({ name: 'Checkout' });
    for (const e of ['e1', 'e2', 'e3']) store().addFlowStep(id, e);
    store().removeElements(['orders']);
    expect(flow(id)!.steps.map((s) => s.edgeId)).toEqual(['e1', 'e3']);
    store().removeElements(['cart']);
    // With e1 gone, e3 becomes the first step, and a first step may start anywhere
    expect(flow(id)!.steps.map((s) => s.edgeId)).toEqual(['e3']);
    store().removeElements(['post']);
    expect(flow(id)!.steps).toEqual([]);
  });
});

describe('connecting to a table row', () => {
  it('a job dropped on a column handle writes the table, anchored to the table', () => {
    const doc = checkoutDoc();
    const withColumn = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.type === 'table' ? { ...n, data: { ...n.data, columns: [{ id: 'c1', name: 'id', type: 'uuid', primaryKey: true, nullable: false, unique: false }] } } : n,
      ),
    };
    store().load(withColumn, 1, 'p1');
    expect(store().connect({ source: 'created', target: 'orders', sourceHandle: 'r', targetHandle: 'col:c1:l' })).toEqual({
      ok: true,
      kind: 'writes',
    });
    expect(store().doc.edges.at(-1)).toMatchObject({ kind: 'writes', sourceHandle: 'r', targetHandle: 'l' });
  });
});
