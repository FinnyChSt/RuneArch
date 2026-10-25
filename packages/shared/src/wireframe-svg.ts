import type { WireComponents } from './canvas';
import { DEVICES, WIRE_COLUMNS, WIRE_ROW_PX, wireframeRows, type WireElement, type Wireframe } from './wireframe';

/*
 * Standalone SVG of a wireframe, for file export (PNG is rasterized from it in the browser) and for
 * the whole-canvas export later. Mirrors the canvas renderer (apps/web canvas/wireframe) with plain
 * shapes at design scale. Exported files can't read the app's CSS variables, so they use a fixed,
 * print-friendly monochrome palette.
 */

export type WireSvgColors = { paper: string; fill: string; line: string; ink: string; strong: string };

/** Light grey on white: readable in docs, tickets and printouts */
export const WIRE_SVG_COLORS: WireSvgColors = {
  paper: '#FFFFFF',
  fill: '#E9EDF2',
  line: '#A3AFBF',
  ink: '#5B6878',
  strong: '#253245',
};

export type WireSvgOptions = {
  colors?: WireSvgColors;
  /** Drawn above the page, e.g. the screen name */
  title?: string;
  /** Components that `instance` elements show (see wireComponentsOf); missing ones draw as a labelled box */
  components?: WireComponents;
};

/** Blank rows below the lowest element, and the gap inside each cell (design px), as on the canvas */
const BOTTOM_ROWS = 2;
const GUTTER = 3;
const FONT = 14;
export const WIRE_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const TITLE_PX = 32;
const ROW_PX = 40;

export const escapeXml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const n = (v: number) => Math.round(v * 100) / 100;
const attrs = (a: Record<string, string | number | undefined>) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${typeof v === 'number' ? n(v) : escapeXml(v!)}"`)
    .join(' ');

type Box = { x: number; y: number; w: number; h: number };

/** Draws one element in its own local box (0,0 → w,h); nested <svg> clips overflowing text */
function drawElement(el: WireElement, box: Box, c: WireSvgColors, components?: WireComponents): string {
  const { w, h } = box;
  const out: string[] = [];
  const rect = (x: number, y: number, rw: number, rh: number, extra: Record<string, string | number | undefined> = {}) =>
    out.push(`<rect ${attrs({ x, y, width: rw, height: rh, rx: 6, ...extra })}/>`);
  const outline = (extra: Record<string, string | number | undefined> = {}) =>
    rect(1, 1, w - 2, h - 2, { fill: 'none', stroke: c.line, 'stroke-width': 2, ...extra });
  const text = (value: string | undefined, x: number, y: number, extra: Record<string, string | number | undefined> = {}) => {
    if (value) out.push(`<text ${attrs({ x, y, fill: c.ink, 'dominant-baseline': 'central', ...extra })}>${escapeXml(value)}</text>`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, stroke = c.line) =>
    out.push(`<line ${attrs({ x1, y1, x2, y2, stroke, 'stroke-width': 2 })}/>`);
  const bar = (x: number, y: number, bw: number) => rect(x, y - 4, bw, 8, { rx: 4, fill: c.fill });
  const mid = h / 2;

  /** Items spread along a row from `x`, with a rough width per character */
  const inline = (items: readonly string[] | undefined, x: number, gap: number, extra = {}) => {
    let at = x;
    for (const item of items ?? []) {
      text(item, at, mid, extra);
      at += item.length * FONT * 0.55 + gap;
    }
  };
  /** Word-wrapped lines of body text */
  const paragraph = (value: string | undefined) => {
    const perLine = Math.max(1, Math.floor(w / (FONT * 0.55)));
    const lines: string[] = [];
    for (const word of (value ?? '').split(/\s+/).filter(Boolean)) {
      const last = lines.at(-1);
      if (last !== undefined && (last + ' ' + word).length <= perLine) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    lines.forEach((l, i) => text(l, 0, FONT * 0.8 + i * FONT * 1.35));
  };
  /** Table-like rows: a header row (tables) or a dot per row (lists) */
  const rows = (count: number, draw: (i: number, y: number) => void) => {
    for (let i = 0; i < count && i * ROW_PX < h; i++) {
      const y = i * ROW_PX;
      draw(i, y);
      if (i > 0) line(0, y, w, y);
    }
    outline();
  };

  switch (el.kind) {
    case 'header':
      rect(0, 0, w, h, { fill: c.fill });
      text(el.text, 16, mid, { fill: c.strong, 'font-weight': 600 });
      inline(el.items, Math.max(16, w - 16 - (el.items ?? []).reduce((s, i) => s + i.length * FONT * 0.55 + 16, 0)), 16);
      break;
    case 'nav':
      if (h > w) {
        rect(0, 0, w, h, { fill: c.fill });
        (el.items ?? []).forEach((item, i) => text(item, 16, 24 + i * 32));
      } else {
        outline();
        inline(el.items, 16, 24);
      }
      break;
    case 'tabs':
      line(0, h - 1, w, h - 1);
      (el.items ?? []).reduce((x, item, i) => {
        const tw = item.length * FONT * 0.55 + 32;
        if (i === 0) rect(x, 0, tw, h - 1, { fill: c.fill });
        text(item, x + 16, mid, i === 0 ? { fill: c.strong } : {});
        return x + tw + 4;
      }, 0);
      break;
    case 'heading':
      text(el.text, 0, mid, { fill: c.strong, 'font-size': 24, 'font-weight': 600 });
      break;
    case 'text':
      paragraph(el.text);
      break;
    case 'button': {
      const primary = el.variant === 'primary';
      if (primary) rect(0, 0, w, h, { fill: c.strong });
      else if (el.variant !== 'ghost') outline({ stroke: c.strong });
      text(el.text, w / 2, mid, { 'text-anchor': 'middle', 'font-weight': 500, fill: primary ? c.paper : c.strong });
      break;
    }
    case 'link':
      text(el.text, 0, mid, { fill: c.strong, 'text-decoration': 'underline' });
      break;
    case 'input':
    case 'select':
      outline();
      text(el.text ?? el.items?.[0], 12, mid, { opacity: 0.8 });
      if (el.kind === 'select') text('▼', w - 12, mid, { 'text-anchor': 'end', 'font-size': 10 });
      break;
    case 'textarea':
      outline();
      text(el.text, 12, 20, { opacity: 0.8 });
      break;
    case 'checkbox':
      rect(0, mid - 8, 16, 16, { rx: 2, fill: 'none', stroke: c.line, 'stroke-width': 2 });
      text(el.text, 24, mid);
      break;
    case 'image':
      outline();
      line(0, 0, w, h);
      line(w, 0, 0, h);
      break;
    case 'card':
      outline();
      text(el.text, 12, 22, { fill: c.strong, 'font-weight': 600 });
      bar(12, 44, (w - 24) * 0.8);
      bar(12, 60, (w - 24) * 0.6);
      break;
    case 'list':
      rows((el.items ?? []).length, (i, y) => {
        out.push(`<circle ${attrs({ cx: 22, cy: y + ROW_PX / 2, r: 10, fill: c.fill })}/>`);
        text(el.items![i], 42, y + ROW_PX / 2);
      });
      break;
    case 'table': {
      const cols = el.items ?? [];
      const cw = w / Math.max(1, cols.length);
      rows(5, (i, y) => {
        if (i === 0) rect(0, 0, w, ROW_PX, { rx: 0, fill: c.fill });
        cols.forEach((col, j) =>
          i === 0 ? text(col, j * cw + 12, ROW_PX / 2, { fill: c.strong, 'font-weight': 600 }) : bar(j * cw + 12, y + ROW_PX / 2, cw * 0.6),
        );
      });
      break;
    }
    case 'form':
      outline({ 'stroke-dasharray': '6 4' });
      text(el.text?.toUpperCase(), 16, 16, { 'font-size': 11, 'letter-spacing': 1 });
      break;
    case 'divider':
      line(0, mid, w, mid);
      break;
    case 'instance': {
      // The component's grid reflows to this box: 12 columns across its width, rows unchanged
      const component = el.componentId ? components?.get(el.componentId) : undefined;
      if (component?.wireframe?.elements.length) out.push(...drawElements(component.wireframe.elements, w / WIRE_COLUMNS, 0, c));
      else text(component?.name ?? 'Missing component', w / 2, mid, { 'text-anchor': 'middle' });
      outline({ 'stroke-dasharray': '2 4', 'stroke-width': 1, stroke: c.line });
      break;
    }
  }
  return out.join('');
}

/** Each element in a nested <svg> at its grid cells (which clips overflowing text) */
function drawElements(
  elements: readonly WireElement[],
  column: number,
  top: number,
  c: WireSvgColors,
  components?: WireComponents,
): string[] {
  return elements.map((el) => {
    const box = {
      x: el.rect.x * column + GUTTER,
      y: top + el.rect.y * WIRE_ROW_PX + GUTTER,
      w: el.rect.w * column - 2 * GUTTER,
      h: el.rect.h * WIRE_ROW_PX - 2 * GUTTER,
    };
    return `<svg ${attrs({ x: box.x, y: box.y, width: box.w, height: box.h, 'data-kind': el.kind })}>${drawElement(el, box, c, components)}</svg>`;
  });
}

/**
 * The wireframe's drawing without the outer <svg>: its paper and elements at design scale, for
 * embedding (the canvas export draws screen thumbnails with it).
 */
export function wireframeSvgContent(
  wf: Wireframe,
  options: Omit<WireSvgOptions, 'title'> & { top?: number } = {},
): { width: number; height: number; content: string } {
  const c = options.colors ?? WIRE_SVG_COLORS;
  const width = DEVICES[wf.device].width;
  const top = options.top ?? 0;
  const height = top + (wireframeRows(wf) + BOTTOM_ROWS) * WIRE_ROW_PX;
  const content = [
    `<rect ${attrs({ width, height, fill: c.paper })}/>`,
    ...drawElements(wf.elements, width / WIRE_COLUMNS, top, c, options.components),
  ].join('\n');
  return { width, height, content };
}

/** The wireframe as a standalone SVG document, at the device's design width */
export function wireframeToSvg(wf: Wireframe, options: WireSvgOptions = {}): string {
  const c = options.colors ?? WIRE_SVG_COLORS;
  const { width, height, content } = wireframeSvgContent(wf, { ...options, top: options.title ? TITLE_PX : 0 });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs({ width, height, viewBox: `0 0 ${n(width)} ${n(height)}` })} font-family="${WIRE_FONT_FAMILY}" font-size="${FONT}">`,
    content,
    options.title
      ? `<text ${attrs({ x: 8, y: TITLE_PX / 2, fill: c.strong, 'font-weight': 600, 'dominant-baseline': 'central' })}>${escapeXml(options.title)}</text>` +
        `<line ${attrs({ x1: 0, y1: TITLE_PX - 0.5, x2: width, y2: TITLE_PX - 0.5, stroke: c.line })}/>`
      : '',
    '</svg>',
    '',
  ].join('\n');
}
