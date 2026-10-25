import { Wireframe, WireKind, type WireElement } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { emptyStack, record, redoStep, undoStep } from './useUndo';
import {
  addElement,
  addInstance,
  componentRows,
  clampRect,
  duplicateElement,
  moveRect,
  newRect,
  nudgeElement,
  PALETTE,
  removeElement,
  reorderElement,
  resizeRect,
  tidyWireframe,
  updateElement,
} from './wireframeDraft';

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const el = (id: string, r = rect(0, 0, 4, 4), extra: Partial<WireElement> = {}): WireElement => ({
  id,
  kind: 'button',
  rect: r,
  ...extra,
});
const wf = (...elements: WireElement[]): Wireframe => ({ device: 'desktop', elements });
const ids = (w: Wireframe) => w.elements.map((e) => e.id);

describe('wireframe draft', () => {
  it('palette defaults are valid elements for every kind (instances are placed from a component)', () => {
    const kinds = WireKind.options.filter((k) => k !== 'instance');
    let w = wf();
    kinds.forEach((kind, i) => (w = addElement(w, kind, `e${i}`)));
    expect(Wireframe.safeParse(w).success).toBe(true);
    expect(w.elements.map((e) => e.kind)).toEqual(kinds);
    expect(w.elements[1]).toMatchObject({ kind: 'nav', items: PALETTE.nav.items });
  });

  it('places a component full width and as tall as its layout', () => {
    const card = wf(el('a', rect(0, 0, 6, 9)), el('b', rect(0, 10, 12, 5)));
    const w = addInstance(wf(el('h', rect(0, 0, 12, 7))), { id: 'card', wireframe: card }, 'i');
    expect(w.elements[1]).toEqual({ id: 'i', kind: 'instance', componentId: 'card', rect: rect(0, 8, 12, 15) });
    expect(addInstance(wf(), { id: 'empty' }, 'j', { x: 6, y: 10 }).elements[0]?.rect).toEqual(rect(0, 8, 12, 4));
    expect(componentRows(undefined)).toBe(4);
  });

  it('adds below everything, or centered on a drop cell', () => {
    const w = wf(el('a', rect(0, 0, 12, 7)));
    expect(newRect(w, 'button')).toEqual(rect(0, 8, 3, 5));
    expect(newRect(wf(), 'button')).toEqual(rect(0, 0, 3, 5));
    expect(newRect(w, 'button', { x: 6, y: 20.4 })).toEqual(rect(5, 18, 3, 5));
    // Dropped at the right edge: pulled back inside the columns
    expect(newRect(w, 'button', { x: 11.8, y: 0 })).toEqual(rect(9, 0, 3, 5));
  });

  it('clamps rects onto the grid', () => {
    expect(clampRect(rect(-2, -3, 4, 2))).toEqual(rect(0, 0, 4, 2));
    expect(clampRect(rect(10, 0, 4, 2))).toEqual(rect(8, 0, 4, 2));
    expect(clampRect(rect(0, 0, 20, 0))).toEqual(rect(0, 0, 12, 1));
    expect(clampRect(rect(1.4, 2.6, 3.5, 1))).toEqual(rect(1, 3, 4, 1));
  });

  it('moves without changing size and stops at the edges', () => {
    expect(moveRect(rect(2, 2, 4, 4), 3, 5)).toEqual(rect(5, 7, 4, 4));
    expect(moveRect(rect(2, 2, 4, 4), 20, -9)).toEqual(rect(8, 0, 4, 4));
  });

  it('resizes from any side, keeping the opposite side and at least one cell', () => {
    const r = rect(2, 10, 4, 6);
    expect(resizeRect(r, 'e', 2, 0)).toEqual(rect(2, 10, 6, 6));
    expect(resizeRect(r, 'e', 20, 0)).toEqual(rect(2, 10, 10, 6));
    expect(resizeRect(r, 'w', -1, 0)).toEqual(rect(1, 10, 5, 6));
    expect(resizeRect(r, 'w', -9, 0)).toEqual(rect(0, 10, 6, 6));
    expect(resizeRect(r, 'w', 9, 0)).toEqual(rect(5, 10, 1, 6));
    expect(resizeRect(r, 's', 0, -10)).toEqual(rect(2, 10, 4, 1));
    expect(resizeRect(r, 'n', 0, -20)).toEqual(rect(2, 0, 4, 16));
    expect(resizeRect(r, 'nw', 1, 2)).toEqual(rect(3, 12, 3, 4));
    expect(resizeRect(r, 'se', 1, 1)).toEqual(rect(2, 10, 5, 7));
  });

  it('updates, nudges and removes by id', () => {
    const w = wf(el('a'), el('b', rect(4, 0, 4, 4)));
    expect(updateElement(w, 'b', { text: 'Go' }).elements[1]?.text).toBe('Go');
    expect(nudgeElement(w, 'b', -1, 2).elements[1]?.rect).toEqual(rect(3, 2, 4, 4));
    expect(nudgeElement(w, 'gone', 1, 1)).toBe(w);
    expect(ids(removeElement(w, 'a'))).toEqual(['b']);
  });

  it('duplicates below the original, next in drawing order, with its own items', () => {
    const w = wf(el('a', rect(0, 2, 4, 3), { items: ['x'] }), el('b'));
    const d = duplicateElement(w, 'a', 'c');
    expect(ids(d)).toEqual(['a', 'c', 'b']);
    expect(d.elements[1]).toMatchObject({ rect: rect(0, 5, 4, 3), items: ['x'] });
    expect(d.elements[1]?.items).not.toBe(w.elements[0]?.items);
  });

  it('brings elements to the front or back', () => {
    const w = wf(el('a'), el('b'), el('c'));
    expect(ids(reorderElement(w, 'a', 'front'))).toEqual(['b', 'c', 'a']);
    expect(ids(reorderElement(w, 'c', 'back'))).toEqual(['c', 'a', 'b']);
  });

  it('tidies blank text and items on save', () => {
    const w = tidyWireframe(wf(el('a', undefined, { text: '  ', items: ['One ', '', '  '] }), el('b', undefined, { items: [''] })));
    expect(w.elements[0]).toMatchObject({ text: undefined, items: ['One'] });
    expect(w.elements[1]?.items).toBeUndefined();
  });
});

describe('undo stack', () => {
  it('undoes and redoes values in order', () => {
    let stack = record(emptyStack<number>(), 1);
    stack = record(stack, 2);
    // present is 3
    const back = undoStep(stack, 3)!;
    expect(back.value).toBe(2);
    const back2 = undoStep(back.stack, 2)!;
    expect(back2.value).toBe(1);
    expect(undoStep(back2.stack, 1)).toBeNull();
    const fwd = redoStep(back2.stack, 1)!;
    expect(fwd.value).toBe(2);
    expect(redoStep(fwd.stack, 2)?.value).toBe(3);
  });

  it('merges consecutive changes with the same key into one step', () => {
    let stack = record(emptyStack<string>(), '');
    stack = record(stack, 'H', 'text');
    stack = record(stack, 'He', 'text');
    expect(stack.past).toEqual(['', 'H']);
    stack = record(stack, 'Hel', 'text');
    expect(stack.past).toEqual(['', 'H']);
    expect(record(stack, 'Hell', 'other').past).toEqual(['', 'H', 'Hell']);
  });

  it('a new change clears the redo stack', () => {
    const back = undoStep(record(emptyStack<number>(), 1), 2)!;
    expect(record(back.stack, 1).future).toEqual([]);
  });
});
