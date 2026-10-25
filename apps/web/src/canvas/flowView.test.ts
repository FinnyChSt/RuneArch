import { describe, expect, it } from 'vitest';
import { checkoutDoc } from '../test/fixtures';
import { flowView, nodeTitle } from './flowView';
import { createNodeMapper, toFlowEdges } from './mapping';

const withFlow = (edgeIds: string[], color = 'teal') => {
  const doc = checkoutDoc();
  return { ...doc, flows: [{ id: 'f', name: 'Checkout', color, steps: edgeIds.map((edgeId) => ({ edgeId })) }] };
};

describe('flowView', () => {
  it('collects the nodes, step numbers and current step of a branching flow', () => {
    const view = flowView(withFlow(['e1', 'e2', 'e3']), 'f', { playhead: 1 })!;
    expect([...view.nodeIds]).toEqual(['cart', 'post', 'orders', 'created']);
    expect([...view.edgeSteps]).toEqual([
      ['e1', 1],
      ['e2', 2],
      ['e3', 3],
    ]);
    expect(view.currentEdgeId).toBe('e2');
    expect(view.color).toBe('var(--flow-teal)');
  });

  it('offers edges that can continue the flow while recording', () => {
    expect([...flowView(withFlow([]), 'f', { recording: true })!.candidateEdgeIds]).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect([...flowView(withFlow(['e1']), 'f', { recording: true })!.candidateEdgeIds]).toEqual(['e2', 'e3']);
    expect(flowView(withFlow(['e1']), 'f')!.candidateEdgeIds.size).toBe(0);
  });

  it('is null without an existing flow; unknown colors fall back to the accent', () => {
    expect(flowView(withFlow([]), null)).toBeNull();
    expect(flowView(withFlow([]), 'gone')).toBeNull();
    expect(flowView(withFlow([], '#ff0000'), 'f')!.color).toBe('var(--accent)');
  });

  it('names nodes for step lists', () => {
    const doc = checkoutDoc();
    expect(doc.nodes.map(nodeTitle)).toEqual(['Cart', 'POST /orders', 'orders', 'order.created', 'Home']);
  });
});

describe('flow highlight mapping', () => {
  const base = { selection: new Set<string>(), invalid: new Set<string>(), measured: {}, dragPositions: {} };

  it('marks flow nodes active and the rest dimmed', () => {
    const doc = withFlow(['e1', 'e2']);
    const nodes = createNodeMapper()(doc, { ...base, flow: flowView(doc, 'f') });
    expect(Object.fromEntries(nodes.map((n) => [n.id, n.className]))).toEqual({
      cart: 'is-active',
      post: 'is-active',
      orders: 'is-active',
      created: 'is-dimmed',
      home: 'is-dimmed',
    });
  });

  it('numbers flow edges in the flow color and flags the current one', () => {
    const doc = withFlow(['e1', 'e2']);
    const edges = toFlowEdges(doc, { ...base, flow: flowView(doc, 'f', { playhead: 0 }) });
    const byId = Object.fromEntries(edges.map((e) => [e.id, e]));
    expect(byId.e1).toMatchObject({ className: 'is-active', data: { flow: { step: 1, current: true } } });
    expect(byId.e2).toMatchObject({ data: { flow: { step: 2, current: false, color: 'var(--flow-teal)' } } });
    expect(byId.e2!.markerEnd).toMatchObject({ color: 'var(--flow-teal)' });
    expect(byId.e4).toMatchObject({ className: 'is-dimmed', data: { flow: { dimmed: true } } });
  });

  it('leaves nodes and edges alone without an active flow', () => {
    const doc = withFlow(['e1']);
    expect(createNodeMapper()(doc, base).every((n) => n.className === undefined)).toBe(true);
    expect(toFlowEdges(doc, base).every((e) => e.className === undefined && !e.data?.flow)).toBe(true);
  });
});
