import type { Position } from '../store/nodeFactory';
import type { Rect } from '../store/layoutOps';

/*
 * Align, distribute and auto-layout on absolute node rects. Pure (auto-layout is async because elkjs
 * is loaded on demand); the store converts the results back to frame-relative positions.
 */

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Lines nodes up on the selection's edge or center; the other axis stays as is */
export function align(rects: readonly Rect[], mode: AlignMode): Record<string, Position> {
  const left = Math.min(...rects.map((r) => r.x));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const place = (r: Rect): Position => {
    switch (mode) {
      case 'left':
        return { x: left, y: r.y };
      case 'center':
        return { x: Math.round((left + right - r.width) / 2), y: r.y };
      case 'right':
        return { x: right - r.width, y: r.y };
      case 'top':
        return { x: r.x, y: top };
      case 'middle':
        return { x: r.x, y: Math.round((top + bottom - r.height) / 2) };
      case 'bottom':
        return { x: r.x, y: bottom - r.height };
    }
  };
  return Object.fromEntries(rects.map((r) => [r.id, place(r)]));
}

/** Equal gaps between nodes along an axis; the first and last stay put (needs three or more) */
export function distribute(rects: readonly Rect[], axis: 'horizontal' | 'vertical'): Record<string, Position> {
  const [pos, size] = axis === 'horizontal' ? (['x', 'width'] as const) : (['y', 'height'] as const);
  const sorted = [...rects].sort((a, b) => a[pos] - b[pos]);
  if (sorted.length < 3) return {};
  const start = sorted[0]![pos];
  const end = Math.max(...sorted.map((r) => r[pos] + r[size]));
  const gap = (end - start - sorted.reduce((sum, r) => sum + r[size], 0)) / (sorted.length - 1);
  let at = start;
  return Object.fromEntries(
    sorted.map((r) => {
      const p = axis === 'horizontal' ? { x: Math.round(at), y: r.y } : { x: r.x, y: Math.round(at) };
      at += r[size] + gap;
      return [r.id, p];
    }),
  );
}

/**
 * Layered layout (left to right, following the connections) with elkjs, anchored at the selection's
 * top-left so it stays where it was. `edges` may mention other nodes; those are ignored.
 */
export async function autoLayout(
  rects: readonly Rect[],
  edges: readonly { source: string; target: string }[],
): Promise<Record<string, Position>> {
  if (rects.length < 2) return {};
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const ids = new Set(rects.map((r) => r.id));
  const seen = new Set<string>();
  const graph = await new ELK().layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children: rects.map((r) => ({ id: r.id, width: r.width, height: r.height })),
    edges: edges.flatMap((e, i) => {
      const key = `${e.source}>${e.target}`;
      if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target || seen.has(key)) return [];
      seen.add(key);
      return [{ id: `e${i}`, sources: [e.source], targets: [e.target] }];
    }),
  });
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  return Object.fromEntries(
    (graph.children ?? []).map((c) => [c.id, { x: Math.round(left + (c.x ?? 0)), y: Math.round(top + (c.y ?? 0)) }]),
  );
}
