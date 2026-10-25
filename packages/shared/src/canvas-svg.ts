import { typeLabel } from './models';
import { wireComponentsOf, type CanvasDoc, type CanvasEdge, type CanvasNode, type FeatureRole, type WireComponents } from './canvas';
import type { FeatureRoles } from './feature-scope';
import { escapeXml, wireframeSvgContent, WIRE_FONT_FAMILY, type WireSvgColors } from './wireframe-svg';
import { DEVICES, elementIdOf, WIRE_ROW_PX, type WireDevice, type Wireframe } from './wireframe';

/*
 * The whole canvas as a standalone SVG: frames, cards, sketches and edges at their canvas positions,
 * optionally with one flow highlighted. Pure, so the export dialog and `GET .../canvas.svg` share it.
 * It redraws the cards schematically (no DOM): the browser passes the sizes React Flow measured so
 * boxes match the canvas; without them (the API) sizes are estimated from the content.
 */

export type CanvasSvgTheme = 'light' | 'dark';

type Palette = {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  edge: string;
  fe: string;
  be: string;
  db: string;
  sketch: string;
  stickyInk: string;
  methods: Record<string, string>;
  wire: WireSvgColors;
};

/** Light: for docs, tickets and slides. Dark: the app's own tokens (apps/web/src/theme/tokens.css). */
export const CANVAS_SVG_THEMES: Record<CanvasSvgTheme, Palette> = {
  light: {
    bg: '#F7F9FC',
    surface: '#FFFFFF',
    raised: '#EEF2F7',
    border: '#C9D3E0',
    text: '#1E2A3A',
    muted: '#5F6F84',
    edge: '#8393A8',
    fe: '#2F9E8F',
    be: '#7A68D1',
    db: '#C48A2C',
    sketch: '#B8A987',
    stickyInk: '#2B2618',
    methods: { GET: '#2E9E62', POST: '#3F7CC7', PUT: '#C48A2C', PATCH: '#C48A2C', DELETE: '#C95454' },
    wire: { paper: '#FFFFFF', fill: '#E9EDF2', line: '#A3AFBF', ink: '#5B6878', strong: '#253245' },
  },
  dark: {
    bg: '#1B2635',
    surface: '#243347',
    raised: '#2C3E55',
    border: '#3A4D66',
    text: '#E6EDF5',
    muted: '#9AABC0',
    edge: '#6B7F99',
    fe: '#6FC3B8',
    be: '#A79BE0',
    db: '#E0B46F',
    sketch: '#D9CFB8',
    stickyInk: '#1B2635',
    methods: { GET: '#6FCF97', POST: '#7FA7D9', PUT: '#E0B46F', PATCH: '#E0B46F', DELETE: '#E07A7A' },
    wire: { paper: '#1F2D3F', fill: '#2E4058', line: '#4E6482', ink: '#A9B8CA', strong: '#D3DDE8' },
  },
};

/** Flow palette keys (Flow.color) as colors; mid-tones that read on both themes */
export const FLOW_SVG_COLORS: Record<string, string> = {
  teal: '#4FB3A6',
  violet: '#8C7FD6',
  amber: '#D9A24E',
  blue: '#5F93D1',
  rose: '#D9749A',
  green: '#6FB85F',
  orange: '#DE8453',
  sky: '#4FB3D9',
};

export type CanvasSvgOptions = {
  theme?: CanvasSvgTheme;
  /** Highlight this flow: its edges in the flow color with step numbers, the rest faded */
  flowId?: string;
  /** Rendered node sizes (React Flow's measurements); estimated when missing */
  sizes?: Readonly<Record<string, { width: number; height: number }>>;
  /** Mark a feature's items: role badges on cards, its added and changed edges in its color */
  feature?: { name: string; color?: string; roles: FeatureRoles };
};

const ROLE_BADGE: Record<FeatureRole, string> = { added: 'NEW', changed: 'CHANGED', uses: 'EXISTING', removed: 'REMOVED' };

type Box = { x: number; y: number; w: number; h: number };
type Side = 'l' | 'r' | 't' | 'b';

const FONT = 13;
const MONO = "ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace";
const PAD = 48;
const CARD_MIN = 176;
const BAR = 4;
const TABLE_HEAD = 28;
const TABLE_ROW = 22;
/** Wireframe thumbnail widths per device, as on the canvas cards */
const THUMB_WIDTH: Record<WireDevice, number> = { desktop: 280, tablet: 220, mobile: 150 };
const COMPONENT_THUMB: Record<WireDevice, number> = { desktop: 220, tablet: 180, mobile: 130 };

const r2 = (v: number) => Math.round(v * 10) / 10;
const attrs = (a: Record<string, string | number | undefined>) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${typeof v === 'number' ? r2(v) : escapeXml(v!)}"`)
    .join(' ');

/** Rough text width: enough to size cards and truncate, no font metrics needed */
const textWidth = (s: string, size = FONT, mono = false) => s.length * size * (mono ? 0.62 : 0.56);

/** Cuts text to fit a width, with an ellipsis */
function fit(s: string, width: number, size = FONT, mono = false): string {
  const max = Math.floor(width / (size * (mono ? 0.62 : 0.56)));
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

const groupColor = (node: CanvasNode, p: Palette) => {
  switch (node.type) {
    case 'screen':
    case 'component':
    case 'store':
      return p.fe;
    case 'endpoint':
    case 'service':
    case 'job':
    case 'external':
      return p.be;
    case 'table':
      return p.db;
    default:
      return p.sketch;
  }
};

/** Height (px) a wireframe thumbnail takes at `width`, clipped at 1.5× the width like on the canvas */
function thumbHeight(wf: Wireframe, width: number) {
  const { width: design, height } = wireframeSvgContent(wf);
  return Math.min(width * 1.5, (height * width) / design);
}

/** Estimated card size when React Flow didn't measure one (e.g. rendering on the server) */
export function estimateNodeSize(node: CanvasNode): { width: number; height: number } {
  if (node.size) return node.size;
  const wide = (...texts: number[]) => Math.max(CARD_MIN, ...texts.map((t) => t + 24));
  switch (node.type) {
    case 'screen': {
      const wf = node.data.wireframe?.elements.length ? node.data.wireframe : undefined;
      const tw = wf ? THUMB_WIDTH[wf.device] : 0;
      return { width: wide(textWidth(node.label), textWidth(node.data.route ?? '/', 12, true) + 40, tw), height: BAR + 28 + 42 + (wf ? thumbHeight(wf, tw) + 12 : 0) };
    }
    case 'component': {
      const wf = node.data.wireframe?.elements.length ? node.data.wireframe : undefined;
      const tw = wf ? COMPONENT_THUMB[wf.device] : 0;
      return { width: wide(textWidth(node.label) + 32, tw), height: BAR + 56 + (wf ? thumbHeight(wf, tw) + 12 : 0) };
    }
    case 'endpoint':
      return { width: wide(textWidth(node.data.path, 12, true) + 64), height: BAR + 70 };
    case 'table': {
      const rows = Math.max(1, node.data.columns.length);
      const widest = Math.max(textWidth(node.label, 12, true), ...node.data.columns.map((c) => textWidth(`${c.name}  ${c.type}`, 12, true) + 28));
      return { width: Math.max(208, widest + 24), height: BAR + TABLE_HEAD + 8 + rows * TABLE_ROW };
    }
    default:
      return { width: wide(textWidth(node.label) + 32), height: BAR + 52 };
  }
}

/* ------------------------------------------------------------ nodes */

type Ctx = { p: Palette; components: WireComponents; models: CanvasDoc['models']; out: string[] };

const rect = (ctx: Ctx, a: Record<string, string | number | undefined>) => ctx.out.push(`<rect ${attrs(a)}/>`);
const text = (ctx: Ctx, value: string, a: Record<string, string | number | undefined>) =>
  ctx.out.push(`<text ${attrs({ 'dominant-baseline': 'central', fill: ctx.p.text, ...a })}>${escapeXml(value)}</text>`);

/** A wireframe thumbnail: the wireframe's own drawing scaled to `width`, clipped to `height` */
function thumbnail(ctx: Ctx, wf: Wireframe, x: number, y: number, width: number) {
  const { width: design, content } = wireframeSvgContent(wf, { colors: ctx.p.wire, components: ctx.components });
  const height = thumbHeight(wf, width);
  const scale = width / design;
  ctx.out.push(
    `<svg ${attrs({ x, y, width, height, viewBox: `0 0 ${r2(design)} ${r2(height / scale)}`, 'font-family': WIRE_FONT_FAMILY, 'font-size': 14 })}>`,
    `<rect ${attrs({ width: design, height: height / scale, rx: 6 / scale, fill: ctx.p.wire.paper })}/>`,
    content,
    '</svg>',
  );
}

/** Card shell: surface, border and the group color bar */
function card(ctx: Ctx, node: CanvasNode, b: Box) {
  ctx.out.push(`<clipPath id="clip-${escapeXml(node.id)}"><rect ${attrs({ x: b.x, y: b.y, width: b.w, height: b.h, rx: 8 })}/></clipPath>`);
  rect(ctx, { x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, fill: ctx.p.surface, stroke: ctx.p.border });
  ctx.out.push(`<g clip-path="url(#clip-${escapeXml(node.id)})">`);
  rect(ctx, { x: b.x, y: b.y, width: b.w, height: BAR, fill: groupColor(node, ctx.p) });
}

function drawNode(ctx: Ctx, node: CanvasNode, b: Box) {
  const { p } = ctx;
  const inner = b.w - 24;
  switch (node.type) {
    case 'frame': {
      const lane = { frontend: p.fe, backend: p.be, database: p.db, none: p.sketch }[node.data.lane];
      rect(ctx, { x: b.x, y: b.y, width: b.w, height: b.h, rx: 12, fill: lane, 'fill-opacity': 0.07, stroke: lane, 'stroke-opacity': 0.6, 'stroke-width': 2, 'stroke-dasharray': '8 6' });
      const label = fit(node.label || 'Frame', b.w - 40);
      rect(ctx, { x: b.x + 12, y: b.y + 8, width: textWidth(label) + 16, height: 22, rx: 6, fill: lane, 'fill-opacity': 0.16 });
      text(ctx, label, { x: b.x + 20, y: b.y + 19, fill: lane, 'font-weight': 500 });
      return;
    }
    case 'sketch':
      return drawSketch(ctx, node, b);
    case 'table': {
      card(ctx, node, b);
      rect(ctx, { x: b.x, y: b.y + BAR, width: b.w, height: TABLE_HEAD, fill: p.raised });
      const name = node.data.schema === 'public' ? node.label : `${node.data.schema}.${node.label}`;
      text(ctx, fit(name || 'untitled', inner, 12, true), { x: b.x + 12, y: b.y + BAR + TABLE_HEAD / 2, 'font-family': MONO, 'font-size': 12, 'font-weight': 600 });
      node.data.columns.forEach((c, i) => {
        const y = b.y + BAR + TABLE_HEAD + 4 + i * TABLE_ROW + TABLE_ROW / 2;
        if (c.primaryKey) text(ctx, 'PK', { x: b.x + 8, y, fill: p.db, 'font-size': 8, 'font-family': MONO, 'font-weight': 700 });
        text(ctx, fit(c.name, inner * 0.55, 12, true), { x: b.x + 26, y, 'font-family': MONO, 'font-size': 12 });
        text(ctx, fit(c.type, inner * 0.4, 12, true), { x: b.x + b.w - 12, y, 'font-family': MONO, 'font-size': 12, fill: p.muted, 'text-anchor': 'end' });
      });
      break;
    }
    case 'endpoint': {
      card(ctx, node, b);
      const method = node.data.method;
      const bw = textWidth(method, 10, true) + 12;
      rect(ctx, { x: b.x + 10, y: b.y + 14, width: bw, height: 18, rx: 4, fill: p.methods[method] ?? p.be });
      text(ctx, method, { x: b.x + 10 + bw / 2, y: b.y + 23, 'font-family': MONO, 'font-size': 10, 'font-weight': 700, fill: p.surface, 'text-anchor': 'middle' });
      text(ctx, fit(node.data.path, b.w - bw - 32, 12, true), { x: b.x + bw + 18, y: b.y + 23, 'font-family': MONO, 'font-size': 12 });
      const sub = node.data.spec.summary || node.label;
      if (sub) text(ctx, fit(sub, inner, 12), { x: b.x + 10, y: b.y + 42, 'font-size': 12, fill: p.muted });
      const body = node.data.spec.requestBody && `${typeLabel(node.data.spec.requestBody.type, ctx.models)} → `;
      text(ctx, fit(`${body ?? ''}${node.data.spec.responses.map((r) => r.status).join(' ')}`, inner, 10, true), {
        x: b.x + 10,
        y: b.y + b.h - 14,
        'font-family': MONO,
        'font-size': 10,
        fill: p.muted,
      });
      break;
    }
    case 'screen': {
      card(ctx, node, b);
      rect(ctx, { x: b.x, y: b.y + BAR, width: b.w, height: 26, fill: p.raised });
      for (const i of [0, 1, 2]) ctx.out.push(`<circle ${attrs({ cx: b.x + 14 + i * 9, cy: b.y + BAR + 13, r: 2.5, fill: p.muted, 'fill-opacity': 0.5 })}/>`);
      text(ctx, fit(node.data.route ?? '/', b.w - 60, 12, true), { x: b.x + 44, y: b.y + BAR + 13, 'font-family': MONO, 'font-size': 12, fill: p.muted });
      text(ctx, fit(node.label || 'Untitled screen', inner), { x: b.x + 12, y: b.y + BAR + 26 + 20, 'font-weight': 500 });
      const wf = node.data.wireframe;
      if (wf?.elements.length) thumbnail(ctx, wf, b.x + 12, b.y + BAR + 26 + 40, Math.min(THUMB_WIDTH[wf.device], inner));
      break;
    }
    case 'component': {
      card(ctx, node, b);
      text(ctx, '⧉', { x: b.x + 12, y: b.y + BAR + 20, fill: p.fe });
      text(ctx, fit(node.label || 'Untitled component', inner - 20), { x: b.x + 32, y: b.y + BAR + 16, 'font-weight': 500 });
      text(ctx, fit(node.data.props.join(', ') || 'Component', inner - 20, 12), { x: b.x + 32, y: b.y + BAR + 34, 'font-size': 12, fill: p.muted });
      const wf = node.data.wireframe;
      if (wf?.elements.length) thumbnail(ctx, wf, b.x + 12, b.y + BAR + 52, Math.min(COMPONENT_THUMB[wf.device], inner));
      break;
    }
    default: {
      card(ctx, node, b);
      const sub =
        node.type === 'service'
          ? `${node.data.methods.length} method${node.data.methods.length === 1 ? '' : 's'}`
          : node.type === 'job'
            ? node.data.schedule || node.data.trigger
            : node.type === 'external'
              ? node.data.baseUrl || 'External'
              : `${node.data.keys.length} keys`;
      text(ctx, fit(node.label || node.type, inner), { x: b.x + 12, y: b.y + BAR + 16, 'font-weight': 500 });
      text(ctx, fit(sub, inner, 12), { x: b.x + 12, y: b.y + BAR + 34, 'font-size': 12, fill: p.muted });
    }
  }
  ctx.out.push('</g>');
}

function drawSketch(ctx: Ctx, node: Extract<CanvasNode, { type: 'sketch' }>, b: Box) {
  const { p } = ctx;
  const { shape } = node.data;
  if (shape === 'freehand') {
    const pts = (node.data.points ?? []).map(([x, y]) => `${r2(b.x + x)},${r2(b.y + y)}`).join(' ');
    ctx.out.push(`<polyline ${attrs({ points: pts, fill: 'none', stroke: p.sketch, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })}/>`);
    return;
  }
  if (shape === 'rect') rect(ctx, { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6, fill: 'none', stroke: p.sketch, 'stroke-width': 2 });
  if (shape === 'ellipse')
    ctx.out.push(`<ellipse ${attrs({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2, fill: 'none', stroke: p.sketch, 'stroke-width': 2 })}/>`);
  if (shape === 'sticky') rect(ctx, { x: b.x, y: b.y, width: b.w, height: b.h, rx: 2, fill: p.sketch });

  // Wrapped text: centered in shapes and notes, top-left for free text
  const lines = wrap(node.data.text ?? '', b.w - 16);
  const lineH = FONT * 1.35;
  const ink = shape === 'sticky' ? p.stickyInk : p.text;
  const x = shape === 'text' ? b.x + 8 : b.x + b.w / 2;
  const top = shape === 'text' ? b.y + 8 + lineH / 2 : b.y + b.h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => text(ctx, line, { x, y: top + i * lineH, fill: ink, 'text-anchor': shape === 'text' ? 'start' : 'middle' }));
}

/** Greedy word wrap to a width */
function wrap(value: string, width: number): string[] {
  const perLine = Math.max(1, Math.floor(width / (FONT * 0.56)));
  return value.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const last = lines.at(-1);
      if (last !== undefined && `${last} ${word}`.length <= perLine) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines.length ? lines : [''];
  });
}

/* ------------------------------------------------------------ edges */

type Anchor = { x: number; y: number; side: Side };

const sidePoint = (b: Box, side: Side, y?: number): Anchor => {
  switch (side) {
    case 't':
      return { x: b.x + b.w / 2, y: b.y, side };
    case 'b':
      return { x: b.x + b.w / 2, y: b.y + b.h, side };
    case 'l':
      return { x: b.x, y: y ?? b.y + b.h / 2, side };
    case 'r':
      return { x: b.x + b.w, y: y ?? b.y + b.h / 2, side };
  }
};

const asSide = (h: string | undefined, fallback: Side): Side => (h === 'l' || h === 'r' || h === 't' || h === 'b' ? h : fallback);

/** React Flow's bezier: control points pushed out along each handle's direction */
function bezier(s: Anchor, t: Anchor): { d: string; mid: { x: number; y: number } } {
  const offset = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d));
  const control = (a: Anchor, o: Anchor) => {
    switch (a.side) {
      case 'l':
        return { x: a.x - offset(a.x - o.x), y: a.y };
      case 'r':
        return { x: a.x + offset(o.x - a.x), y: a.y };
      case 't':
        return { x: a.x, y: a.y - offset(a.y - o.y) };
      case 'b':
        return { x: a.x, y: a.y + offset(o.y - a.y) };
    }
  };
  const c1 = control(s, t);
  const c2 = control(t, s);
  const mid = {
    x: 0.125 * s.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * t.x,
    y: 0.125 * s.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * t.y,
  };
  return { d: `M${r2(s.x)},${r2(s.y)} C${r2(c1.x)},${r2(c1.y)} ${r2(c2.x)},${r2(c2.y)} ${r2(t.x)},${r2(t.y)}`, mid };
}

const DASH: Partial<Record<CanvasEdge['kind'], string>> = { navigates: '6 4', emits: '1.5 4' };
const SHOW_KIND: CanvasEdge['kind'][] = ['reads', 'writes', 'emits'];
const CRUD_LETTER = { create: 'C', read: 'R', update: 'U', delete: 'D' } as const;

function edgeLabel(e: CanvasEdge): string | undefined {
  if (e.kind === 'fk') return undefined;
  if (e.label) return e.label;
  if (e.crud?.length) return e.crud.map((op) => CRUD_LETTER[op]).join('');
  return SHOW_KIND.includes(e.kind) ? e.kind : undefined;
}

/* ------------------------------------------------------------ document */

/** The canvas (or one flow of it) as a standalone SVG document */
export function canvasToSvg(doc: Pick<CanvasDoc, 'nodes' | 'edges' | 'flows' | 'models'>, options: CanvasSvgOptions = {}): string {
  const p = CANVAS_SVG_THEMES[options.theme ?? 'light'];
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const boxes = new Map<string, Box>();
  for (const n of doc.nodes) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    const size = options.sizes?.[n.id] ?? estimateNodeSize(n);
    boxes.set(n.id, {
      x: n.position.x + (parent?.position.x ?? 0),
      y: n.position.y + (parent?.position.y ?? 0),
      w: size.width,
      h: size.height,
    });
  }

  // Flow highlight: steps, their nodes, and the flow's color
  const flow = options.flowId ? doc.flows.find((f) => f.id === options.flowId) : undefined;
  const flowColor = flow ? (FLOW_SVG_COLORS[flow.color ?? ''] ?? FLOW_SVG_COLORS.violet!) : undefined;
  const steps = new Map(flow?.steps.map((s, i) => [s.edgeId, i + 1]));
  const flowNodes = new Set(doc.edges.filter((e) => steps.has(e.id)).flatMap((e) => [e.source, e.target]));
  const faded = (inFlow: boolean) => (flow && !inFlow ? 0.25 : undefined);

  // Feature marks: role badges on cards, added and changed edges in the feature color, removed ones dashed red
  const feature = options.feature;
  const featureColor = feature ? (FLOW_SVG_COLORS[feature.color ?? ''] ?? FLOW_SVG_COLORS.violet!) : undefined;
  const danger = p.methods.DELETE!;
  const featureRole = (kind: 'node' | 'edge', id: string) => feature?.roles.get(`${kind}:${id}`);

  const ctx: Ctx = { p, components: wireComponentsOf(doc), models: doc.models, out: [] };
  const frames = doc.nodes.filter((n) => n.type === 'frame');
  const others = doc.nodes.filter((n) => n.type !== 'frame');
  const badge = (role: FeatureRole, b: Box) => {
    const label = ROLE_BADGE[role];
    const w = textWidth(label, 9) + 12;
    const x = b.x + b.w - w - 10;
    const fill = role === 'added' ? featureColor! : p.bg;
    const stroke = role === 'added' || role === 'changed' ? featureColor! : role === 'removed' ? danger : p.border;
    const ink = role === 'added' ? p.surface : role === 'uses' ? p.muted : stroke;
    if (role === 'removed') rect(ctx, { x: b.x - 2, y: b.y - 2, width: b.w + 4, height: b.h + 4, rx: 10, fill: 'none', stroke: danger, 'stroke-width': 1.5, 'stroke-dasharray': '5 4' });
    if (role === 'added' || role === 'changed') rect(ctx, { x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, fill: 'none', stroke: featureColor, 'stroke-width': 1.5 });
    rect(ctx, { x, y: b.y - 8, width: w, height: 16, rx: 4, fill, stroke });
    text(ctx, label, { x: x + w / 2, y: b.y, fill: ink, 'font-size': 9, 'font-weight': 700, 'text-anchor': 'middle' });
  };
  const layer = (list: CanvasNode[]) => {
    for (const n of list) {
      const opacity = faded(flowNodes.has(n.id) || n.type === 'frame');
      if (opacity) ctx.out.push(`<g opacity="${opacity}">`);
      drawNode(ctx, n, boxes.get(n.id)!);
      const role = n.type === 'frame' ? undefined : featureRole('node', n.id);
      if (role) badge(role, boxes.get(n.id)!);
      if (opacity) ctx.out.push('</g>');
    }
  };

  // Frames, then edges, then cards and sketches; edge labels and step badges on top
  layer(frames);
  const labels: string[] = [];
  const pairKeys = new Set(doc.edges.filter((e) => e.kind !== 'fk').map((e) => `${e.source}>${e.target}`));
  for (const e of doc.edges) {
    const sb = boxes.get(e.source);
    const tb = boxes.get(e.target);
    const source = nodes.get(e.source);
    const target = nodes.get(e.target);
    if (!sb || !tb || !source || !target) continue;
    let s: Anchor;
    let t: Anchor;
    const facing: [Side, Side] = tb.x + tb.w / 2 < sb.x + sb.w / 2 ? ['l', 'r'] : ['r', 'l'];
    if (e.kind === 'fk') {
      // Column rows: each end leaves the table on the side facing the other
      const row = (node: CanvasNode, box: Box, columnId: string) => {
        const i = node.type === 'table' ? node.data.columns.findIndex((c) => c.id === columnId) : -1;
        return box.y + BAR + TABLE_HEAD + 4 + Math.max(0, i) * TABLE_ROW + TABLE_ROW / 2;
      };
      const sides: [Side, Side] = e.source === e.target ? ['r', 'r'] : facing;
      s = sidePoint(sb, sides[0], row(source, sb, e.data.sourceColumnId));
      t = sidePoint(tb, sides[1], row(target, tb, e.data.targetColumnId));
    } else {
      const elementId = elementIdOf(e.sourceHandle);
      const tableTop = (node: CanvasNode, box: Box) => (node.type === 'table' ? box.y + 18 : undefined);
      if (elementId !== null && source.type === 'screen' && source.data.wireframe) {
        // Element links leave the button (or form, ...) inside the thumbnail, on the side facing the target
        const wf = source.data.wireframe;
        const el = wf.elements.find((x) => x.id === elementId);
        const tw = Math.min(THUMB_WIDTH[wf.device], sb.w - 24);
        const scale = tw / DEVICES[wf.device].width;
        const thumbTop = sb.y + BAR + 26 + 40;
        const y = el ? thumbTop + Math.min((el.rect.y + el.rect.h / 2) * WIRE_ROW_PX * scale, thumbHeight(wf, tw) - 4) : undefined;
        s = sidePoint(sb, facing[0], y);
      } else s = sidePoint(sb, asSide(e.sourceHandle, 'r'), tableTop(source, sb));
      t = sidePoint(tb, asSide(e.targetHandle, 't'), tableTop(target, tb));
      // Two-way pairs are drawn side by side
      if (pairKeys.has(`${e.target}>${e.source}`)) {
        const by = (e.source < e.target ? 1 : -1) * 10;
        for (const a of [s, t]) {
          if (a.side === 'l' || a.side === 'r') a.y += by;
          else a.x += by;
        }
      }
    }

    const { d, mid } = bezier(s, t);
    const step = steps.get(e.id);
    const role = featureRole('edge', e.id);
    const accent = !step && (role === 'added' || role === 'changed');
    const color = step ? flowColor! : accent ? featureColor! : role === 'removed' ? danger : p.edge;
    const marker = e.kind === 'fk' ? undefined : `url(#arrow-${step ? 'flow' : accent ? 'feature' : 'edge'})`;
    ctx.out.push(
      `<path ${attrs({ d, fill: 'none', stroke: color, 'stroke-width': step ? 2.5 : accent ? 2 : 1.5, 'stroke-dasharray': role === 'removed' ? '5 4' : DASH[e.kind], 'stroke-linecap': 'round', 'marker-end': marker, 'marker-start': e.kind === 'fk' ? 'url(#crow)' : undefined, opacity: faded(step !== undefined) })}/>`,
    );
    const label = edgeLabel(e);
    if (step) {
      labels.push(`<circle ${attrs({ cx: mid.x, cy: mid.y, r: 10, fill: color })}/>`);
      labels.push(`<text ${attrs({ x: mid.x, y: mid.y, fill: p.surface, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle', 'dominant-baseline': 'central' })}>${step}</text>`);
    } else if (label) {
      const w = textWidth(label, 10, true) + 10;
      const o = faded(false);
      labels.push(`<g${o ? ` opacity="${o}"` : ''}><rect ${attrs({ x: mid.x - w / 2, y: mid.y - 8, width: w, height: 16, rx: 4, fill: p.surface, stroke: p.border })}/>`);
      labels.push(`<text ${attrs({ x: mid.x, y: mid.y, fill: p.muted, 'font-size': 10, 'font-family': MONO, 'text-anchor': 'middle', 'dominant-baseline': 'central' })}>${escapeXml(label)}</text></g>`);
    }
  }
  layer(others);

  const all = [...boxes.values()];
  const minX = all.length ? Math.min(...all.map((b) => b.x)) - PAD : 0;
  const minY = all.length ? Math.min(...all.map((b) => b.y)) - PAD : 0;
  const width = all.length ? Math.max(...all.map((b) => b.x + b.w)) + PAD - minX : 400;
  const height = all.length ? Math.max(...all.map((b) => b.y + b.h)) + PAD - minY : 200;
  const arrow = (id: string, fill: string) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs({ width, height, viewBox: `${r2(minX)} ${r2(minY)} ${r2(width)} ${r2(height)}` })} font-family="${escapeXml(WIRE_FONT_FAMILY)}" font-size="${FONT}">`,
    `<defs>${arrow('arrow-edge', p.edge)}${arrow('arrow-flow', flowColor ?? p.edge)}${arrow('arrow-feature', featureColor ?? p.edge)}` +
      `<marker id="crow" viewBox="0 0 12 12" refX="1" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M12,6 L1,1 M12,6 L1,6 M12,6 L1,11" stroke="${p.edge}" stroke-width="1.2" fill="none"/></marker></defs>`,
    `<rect ${attrs({ x: minX, y: minY, width, height, fill: p.bg })}/>`,
    ...(all.length ? [] : [`<text ${attrs({ x: 200, y: 100, fill: p.muted, 'text-anchor': 'middle', 'dominant-baseline': 'central' })}>Empty canvas</text>`]),
    ...(flow
      ? [`<text ${attrs({ x: minX + 16, y: minY + 20, fill: flowColor, 'font-weight': 600, 'dominant-baseline': 'central' })}>${escapeXml(`Flow: ${flow.name}`)}</text>`]
      : feature
        ? [`<text ${attrs({ x: minX + 16, y: minY + 20, fill: featureColor, 'font-weight': 600, 'dominant-baseline': 'central' })}>${escapeXml(`Feature: ${feature.name}`)}</text>`]
        : []),
    ...ctx.out,
    ...labels,
    '</svg>',
    '',
  ].join('\n');
}
