import type { CanvasDoc } from '@flowcanvas/shared';

/** Palette keys stored in Flow.color; each maps to a --flow-<key> token */
export const FLOW_COLORS = ['violet', 'teal', 'amber', 'blue', 'rose', 'green', 'orange', 'sky'] as const;
export type FlowColor = (typeof FLOW_COLORS)[number];

const isFlowColor = (value: string | undefined): value is FlowColor => FLOW_COLORS.includes(value as FlowColor);

/** CSS color for a flow; unknown values (e.g. an imported hex) fall back to the accent */
export const flowColorVar = (color: string | undefined) =>
  isFlowColor(color) ? `var(--flow-${color})` : 'var(--accent)';

/** First palette color no flow uses yet (cycles when all are taken) */
export function nextFlowColor(doc: CanvasDoc): FlowColor {
  const used = new Set(doc.flows.map((f) => f.color));
  return FLOW_COLORS.find((c) => !used.has(c)) ?? FLOW_COLORS[doc.flows.length % FLOW_COLORS.length]!;
}
