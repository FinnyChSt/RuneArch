import { CanvasDoc } from '@flowcanvas/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '../store/canvasStore';
import { applyScreenEdit, elementLinksOf } from '../store/docOps';
import { wireframedCheckoutDoc } from '../test/fixtures';
import { checkConnection } from './connectRules';
import { flowView, sourceTitle } from './flowView';
import { createNodeMapper, toFlowEdges, type ViewState } from './mapping';

/* Links from wireframe elements (a button, a link, ...) to endpoints and screens */

const view = (over: Partial<ViewState> = {}): ViewState => ({
  selection: new Set(),
  invalid: new Set(),
  measured: {},
  dragPositions: {},
  ...over,
});

const cartOf = (doc: CanvasDoc) => {
  const cart = doc.nodes.find((n) => n.id === 'cart');
  if (cart?.type !== 'screen') throw new Error('no cart');
  return cart;
};

describe('connect rules for elements', () => {
  const doc = wireframedCheckoutDoc();

  it('picks the kind from the screen: calls an endpoint, navigates to a screen', () => {
    expect(checkConnection(doc, { source: 'cart', target: 'home', sourceHandle: 'el:back:l' })).toEqual({
      ok: true,
      kind: 'navigates',
    });
    // The screen-level `calls` edge (e1) does not block a button calling the same endpoint
    expect(checkConnection(doc, { source: 'cart', target: 'post', sourceHandle: 'el:back:r' })).toEqual({
      ok: true,
      kind: 'calls',
    });
  });

  it('rejects unknown and non-interactive elements, and repeated links from one element', () => {
    expect(checkConnection(doc, { source: 'cart', target: 'post', sourceHandle: 'el:gone:r' })).toMatchObject({
      ok: false,
      reason: 'Unknown screen element',
    });
    expect(checkConnection(doc, { source: 'cart', target: 'post', sourceHandle: 'el:pic:r' })).toMatchObject({
      ok: false,
      reason: 'Only buttons, links, forms and lists can start a connection',
    });
    expect(checkConnection(doc, { source: 'cart', target: 'post', sourceHandle: 'el:place:l' })).toMatchObject({
      ok: false,
      reason: 'These nodes are already connected',
    });
  });

  it('stores the element without the side on connect', () => {
    useCanvasStore.getState().load(doc, 1, 'p1');
    const result = useCanvasStore.getState().connect({ source: 'cart', target: 'home', sourceHandle: 'el:back:r', targetHandle: 't' });
    expect(result).toEqual({ ok: true, kind: 'navigates' });
    const edge = useCanvasStore.getState().doc.edges.at(-1);
    expect(edge).toMatchObject({ kind: 'navigates', source: 'cart', target: 'home', sourceHandle: 'el:back' });
  });
});

describe('mapping', () => {
  it('leaves an element on the side facing its target', () => {
    const doc = wireframedCheckoutDoc(); // cart at x 0, post at x 300
    const click = () => toFlowEdges(doc, view()).find((e) => e.id === 'click');
    expect(click()?.sourceHandle).toBe('el:place:r');
    const moved = view({ dragPositions: { post: { x: -600, y: 0 } } });
    expect(toFlowEdges(doc, moved).find((e) => e.id === 'click')?.sourceHandle).toBe('el:place:l');
  });

  it('marks elements that start flow steps, with the current one', () => {
    const doc = {
      ...wireframedCheckoutDoc(),
      flows: [{ id: 'f', name: 'Checkout', color: 'teal', steps: [{ edgeId: 'click' }, { edgeId: 'e2' }] }],
    };
    const flow = flowView(doc, 'f', { playhead: 0 })!;
    expect(flow.elementSteps.get('cart')).toEqual(new Map([['place', 1]]));
    expect(flow.currentElement).toEqual({ nodeId: 'cart', elementId: 'place' });

    const nodes = createNodeMapper()(doc, view({ flow }));
    expect(nodes.find((n) => n.id === 'cart')?.data.flowMarks).toEqual({
      color: 'var(--flow-teal)',
      steps: { place: 1 },
      current: 'place',
    });
    expect(nodes.find((n) => n.id === 'home')?.data.flowMarks).toBeUndefined();
    expect(flowView(doc, 'f', { playhead: 1 })?.currentElement).toBeNull();
  });

  it('names the element in step titles', () => {
    const doc = wireframedCheckoutDoc();
    expect(sourceTitle(cartOf(doc), 'el:place')).toBe('Cart · Place order');
    expect(sourceTitle(cartOf(doc), 'r')).toBe('Cart');
  });
});

describe('applyScreenEdit', () => {
  it('reads the links of a screen', () => {
    expect(elementLinksOf(wireframedCheckoutDoc(), 'cart')).toEqual([{ id: 'click', elementId: 'place', targetId: 'post' }]);
  });

  it('adds new links as edges and removes dropped ones with their flow steps', () => {
    const doc = {
      ...wireframedCheckoutDoc(),
      flows: [{ id: 'f', name: 'Checkout', steps: [{ edgeId: 'click' }, { edgeId: 'e2' }] }],
    };
    const next = applyScreenEdit(doc, cartOf(doc), [{ id: 'nav', elementId: 'back', targetId: 'home' }]);
    expect(CanvasDoc.safeParse(next).success).toBe(true);
    expect(next.edges.find((e) => e.id === 'click')).toBeUndefined();
    expect(next.edges.find((e) => e.id === 'nav')).toEqual({
      id: 'nav',
      kind: 'navigates',
      source: 'cart',
      target: 'home',
      sourceHandle: 'el:back',
    });
    // The flow loses the removed step; the next one becomes its first
    expect(next.flows[0]?.steps).toEqual([{ edgeId: 'e2' }]);
    // Screen-level edges stay
    expect(next.edges.map((e) => e.id)).toContain('e1');
  });

  it('drops the links of deleted elements (and of a removed wireframe)', () => {
    const doc = wireframedCheckoutDoc();
    const cart = cartOf(doc);
    const withoutButton = {
      ...cart,
      data: { ...cart.data, wireframe: { ...cart.data.wireframe!, elements: cart.data.wireframe!.elements.filter((e) => e.id !== 'place') } },
    };
    const links = elementLinksOf(doc, 'cart');
    const next = applyScreenEdit(doc, withoutButton, links);
    expect(CanvasDoc.safeParse(next).success).toBe(true);
    expect(next.edges.find((e) => e.id === 'click')).toBeUndefined();

    const noWireframe = applyScreenEdit(doc, { ...cart, data: { ...cart.data, wireframe: undefined } }, links);
    expect(CanvasDoc.safeParse(noWireframe).success).toBe(true);
    expect(noWireframe.edges.some((e) => e.sourceHandle?.startsWith('el:'))).toBe(false);
  });

  it('keeps the doc when nothing changed', () => {
    const doc = wireframedCheckoutDoc();
    expect(applyScreenEdit(doc, cartOf(doc), elementLinksOf(doc, 'cart')).edges).toEqual(doc.edges);
  });
});

beforeEach(() => useCanvasStore.getState().load(wireframedCheckoutDoc(), 1, 'p1'));
