import { describe, expect, it } from 'vitest';
import { align, autoLayout, distribute } from './arrange';

const r = (id: string, x: number, y: number, width = 100, height = 50) => ({ id, x, y, width, height });

describe('align', () => {
  const rects = [r('a', 0, 0), r('b', 200, 100, 50, 30), r('c', 100, 300, 200, 80)];
  it('lines nodes up on an edge or center', () => {
    expect(align(rects, 'left')).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, c: { x: 0, y: 300 } });
    expect(align(rects, 'right')).toEqual({ a: { x: 200, y: 0 }, b: { x: 250, y: 100 }, c: { x: 100, y: 300 } });
    expect(align(rects, 'center').b).toEqual({ x: 125, y: 100 });
    expect(align(rects, 'bottom').a).toEqual({ x: 0, y: 330 });
    expect(align(rects, 'middle').a).toEqual({ x: 0, y: 165 });
  });
});

describe('distribute', () => {
  it('spaces nodes evenly between the outer two', () => {
    const rects = [r('a', 0, 0), r('c', 400, 0), r('b', 120, 0, 50)];
    expect(distribute(rects, 'horizontal')).toEqual({ a: { x: 0, y: 0 }, b: { x: 225, y: 0 }, c: { x: 400, y: 0 } });
    expect(distribute(rects.slice(0, 2), 'vertical')).toEqual({});
  });
});

describe('autoLayout', () => {
  it('lays out left to right along the edges, anchored at the selection', async () => {
    const rects = [r('c', 500, 500), r('a', 100, 80), r('b', 300, 300)];
    const p = await autoLayout(rects, [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'a', target: 'elsewhere' },
    ]);
    expect(p.a!.x).toBeLessThan(p.b!.x);
    expect(p.b!.x).toBeLessThan(p.c!.x);
    expect(Math.min(p.a!.x, p.b!.x, p.c!.x)).toBeGreaterThanOrEqual(100);
    expect(Math.min(p.a!.y, p.b!.y, p.c!.y)).toBeGreaterThanOrEqual(80);
  });
});
