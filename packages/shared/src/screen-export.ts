import { modelRefOf, type ApiModel, type FieldType } from './api';
import type { CanvasDoc, CanvasNode } from './canvas';
import { typeLabel } from './models';
import { elementIdOf, type WireDevice, type WireElement, type WireKind } from './wireframe';

/* ============================================================
 * Screen descriptions — what each screen shows, what its elements do and which endpoints it
 * calls. A structured hand-off for building the frontend (by a person or an AI). Pure, used by
 * the screens dialog and `GET /projects/:id/screens.<extension>`.
 * ============================================================ */

type Doc = Pick<CanvasDoc, 'nodes' | 'edges' | 'models'>;
type Screen = Extract<CanvasNode, { type: 'screen' }>;
type Endpoint = Extract<CanvasNode, { type: 'endpoint' }>;
type Component = Extract<CanvasNode, { type: 'component' }>;

export type ScreenAction = { kind: string; target: string };

export type ScreenElementDescription = {
  id: string;
  kind: WireKind;
  text?: string;
  items?: string[];
  /** Name of the model a form submits or a list/table shows */
  model?: string;
  /** Instances: name of the placed component (described under `components`) */
  component?: string;
  /** What happens on click: `calls` an endpoint, `navigates` to a screen, ... */
  actions: ScreenAction[];
};

export type EndpointCall = {
  method: string;
  path: string;
  summary?: string;
  /** What triggers the call: element labels, or "screen" for a screen-level connection */
  triggers: string[];
  requestBody?: string;
  responses: { status: string; description?: string; body?: string }[];
};

export type ScreenDescription = {
  id: string;
  name: string;
  route?: string;
  device?: WireDevice;
  state: string[];
  notes?: string;
  /** Screens that navigate here */
  reachedFrom: string[];
  /** Wireframe elements in reading order (top to bottom, left to right); dividers left out */
  elements: ScreenElementDescription[];
  /** Screen-level connections to nodes other than endpoints (other screens, stores, ...) */
  actions: ScreenAction[];
  calls: EndpointCall[];
};

export type ComponentDescription = {
  name: string;
  props: string[];
  notes?: string;
  elements: ScreenElementDescription[];
};

export type ScreensDescription = {
  screens: ScreenDescription[];
  /** Components placed on the screens, with their own layout */
  components: ComponentDescription[];
  /** Models used by the screens' elements and called endpoints, with their fields */
  models: { name: string; description?: string; fields: { name: string; type: string; required: boolean; nullable: boolean }[] }[];
};

const titleOf = (n: CanvasNode | undefined) =>
  !n ? '?' : n.type === 'endpoint' ? `${n.data.method} ${n.data.path}` : n.label || n.type;

const elementLabel = (el: WireElement) => el.text?.trim() || el.kind;

/** Models referenced by a type, following refs inside models (each once) */
function collectModels(type: FieldType | undefined, models: ReadonlyMap<string, ApiModel>, into: Set<string>) {
  const id = type && modelRefOf(type);
  const model = id ? models.get(id) : undefined;
  if (!model || into.has(model.id)) return;
  into.add(model.id);
  for (const f of model.fields) collectModels(f.type, models, into);
}

export function describeScreens(doc: Doc): ScreensDescription {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const models = new Map(doc.models.map((m) => [m.id, m]));
  const usedModels = new Set<string>();
  const usedComponents = new Set<string>();
  const label = (t: FieldType) => typeLabel(t, doc.models);

  const screens = doc.nodes
    .filter((n): n is Screen => n.type === 'screen')
    .map((screen): ScreenDescription => {
      const wireframe = screen.data.wireframe;
      const elementById = new Map(wireframe?.elements.map((el) => [el.id, el]));
      const elementActions = new Map<string, ScreenAction[]>();
      const actions: ScreenAction[] = [];
      const calls = new Map<string, EndpointCall>();

      for (const e of doc.edges) {
        if (e.kind === 'fk' || e.source !== screen.id) continue;
        const target = nodes.get(e.target);
        const element = elementById.get(elementIdOf(e.sourceHandle) ?? '');
        const action = { kind: e.kind, target: e.label?.trim() || titleOf(target) };
        if (element) elementActions.set(element.id, [...(elementActions.get(element.id) ?? []), action]);
        if (target?.type === 'endpoint') {
          const call = calls.get(target.id) ?? describeCall(target);
          call.triggers.push(element ? elementLabel(element) : 'screen');
          calls.set(target.id, call);
        } else if (!element) actions.push(action);
      }

      const elements = describeElements(wireframe?.elements ?? [], elementActions);

      const reachedFrom = [
        ...new Set(
          doc.edges
            .filter((e) => e.kind === 'navigates' && e.target === screen.id && nodes.get(e.source)?.type === 'screen')
            .map((e) => titleOf(nodes.get(e.source))),
        ),
      ];

      return {
        id: screen.id,
        name: screen.label || 'Untitled screen',
        ...(screen.data.route && { route: screen.data.route }),
        ...(wireframe && { device: wireframe.device }),
        state: screen.data.state,
        ...(screen.notes && { notes: screen.notes }),
        reachedFrom,
        elements,
        actions,
        calls: [...calls.values()],
      };
    });

  /** Elements in reading order (top to bottom, left to right), dividers left out */
  function describeElements(list: readonly WireElement[], actions?: ReadonlyMap<string, ScreenAction[]>) {
    return [...list]
      .filter((el) => el.kind !== 'divider')
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
      .map((el): ScreenElementDescription => {
        const model = el.modelRef ? models.get(el.modelRef) : undefined;
        if (model) collectModels({ kind: 'ref', modelId: model.id }, models, usedModels);
        const component = el.componentId ? nodes.get(el.componentId) : undefined;
        if (component?.type === 'component') usedComponents.add(component.id);
        return {
          id: el.id,
          kind: el.kind,
          ...(el.text?.trim() && { text: el.text.trim() }),
          ...(el.items?.length && { items: el.items }),
          ...(model && { model: model.name }),
          ...(component && { component: titleOf(component) }),
          actions: actions?.get(el.id) ?? [],
        };
      });
  }

  function describeCall(endpoint: Endpoint): EndpointCall {
    const { method, path, spec } = endpoint.data;
    collectModels(spec.requestBody?.type, models, usedModels);
    for (const r of spec.responses) collectModels(r.body, models, usedModels);
    return {
      method,
      path,
      ...(spec.summary && { summary: spec.summary }),
      triggers: [],
      ...(spec.requestBody && { requestBody: label(spec.requestBody.type) }),
      responses: spec.responses.map((r) => ({
        status: r.status,
        ...(r.description && { description: r.description }),
        ...(r.body && { body: label(r.body) }),
      })),
    };
  }

  // Described after the screens, so their models join the list below
  const components = doc.nodes
    .filter((n): n is Component => n.type === 'component' && usedComponents.has(n.id))
    .map(
      (c): ComponentDescription => ({
        name: titleOf(c),
        props: c.data.props,
        ...(c.notes && { notes: c.notes }),
        elements: describeElements(c.data.wireframe?.elements ?? []),
      }),
    );

  return {
    screens,
    components,
    models: doc.models
      .filter((m) => usedModels.has(m.id))
      .map((m) => ({
        name: m.name,
        ...(m.description && { description: m.description }),
        fields: m.fields.map((f) => ({ name: f.name, type: label(f.type), required: f.required, nullable: f.nullable })),
      })),
  };
}

/* ------------------------------------------------------------
 * Markdown: readable for people, compact for an AI
 * ------------------------------------------------------------ */

const code = (s: string) => `\`${s.replaceAll('`', "'")}\``;
const quoted = (s: string) => `"${s.replaceAll('\n', ' ')}"`;

function elementLine(el: ScreenElementDescription): string {
  let line = el.component ? `- component ${code(el.component)}` : `- ${el.kind}`;
  if (el.text) line += ` ${quoted(el.text)}`;
  if (el.items) line += ` (${el.items.join(', ')})`;
  if (el.model) line += ` — model ${code(el.model)}`;
  for (const a of el.actions) line += ` → ${a.kind} ${a.kind === 'calls' ? code(a.target) : a.target}`;
  return line;
}

export function toScreensMarkdown(doc: Doc): string {
  const { screens, components, models } = describeScreens(doc);
  const out = ['# Screens', '', '<!-- Generated by RuneArch -->', ''];
  if (screens.length === 0) out.push('No screens on the canvas yet.', '');

  for (const s of screens) {
    out.push(`## ${s.name}${s.route ? ` (${code(s.route)})` : ''}`, '');
    const meta = [
      s.device && `Device: ${s.device}`,
      s.state.length > 0 && `State: ${s.state.map(code).join(', ')}`,
      s.reachedFrom.length > 0 && `Reached from: ${s.reachedFrom.join(', ')}`,
    ].filter(Boolean);
    if (meta.length) out.push(meta.join(' · '), '');
    if (s.notes) out.push(s.notes, '');

    out.push('### Layout', '');
    out.push(...(s.elements.length ? s.elements.map(elementLine) : ['No wireframe.']), '');

    if (s.actions.length) out.push('### Links', '', ...s.actions.map((a) => `- ${a.kind} ${a.target}`), '');

    if (s.calls.length) {
      out.push('### Calls', '');
      for (const c of s.calls) {
        const on = c.triggers.filter((t) => t !== 'screen').map(quoted);
        out.push(`- ${code(`${c.method} ${c.path}`)}${c.summary ? ` — ${c.summary}` : ''}${on.length ? ` (on ${on.join(', ')})` : ''}`);
        if (c.requestBody) out.push(`  - Body: ${code(c.requestBody)}`);
        for (const r of c.responses)
          out.push(`  - ${r.status}${r.body ? `: ${code(r.body)}` : ''}${r.description ? ` — ${r.description}` : ''}`);
      }
      out.push('');
    }
  }

  if (components.length) {
    out.push('## Components', '');
    for (const c of components) {
      out.push(`### ${c.name}`, '');
      if (c.props.length) out.push(`Props: ${c.props.map(code).join(', ')}`, '');
      if (c.notes) out.push(c.notes, '');
      out.push(...(c.elements.length ? c.elements.map(elementLine) : ['No wireframe.']), '');
    }
  }

  if (models.length) {
    out.push('## Models', '');
    for (const m of models) {
      out.push(`### ${m.name}`, '');
      if (m.description) out.push(m.description, '');
      out.push(
        ...(m.fields.length
          ? m.fields.map((f) => `- ${f.name}${f.required ? '' : '?'}: ${code(f.type + (f.nullable ? ' | null' : ''))}`)
          : ['No fields.']),
        '',
      );
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

export const toScreensJson = (doc: Doc) => `${JSON.stringify(describeScreens(doc), null, 2)}\n`;

/* ------------------------------------------------------------
 * Registry, like SCHEMA_EXPORTS: drives the screens dialog and the export route
 * ------------------------------------------------------------ */

export type ScreenExport = { label: string; extension: string; mimeType: string; render(doc: Doc): string };

export const SCREEN_EXPORTS = {
  markdown: { label: 'Markdown', extension: 'md', mimeType: 'text/markdown', render: toScreensMarkdown },
  json: { label: 'JSON', extension: 'json', mimeType: 'application/json', render: toScreensJson },
} as const satisfies Record<string, ScreenExport>;

export type ScreenExportFormat = keyof typeof SCREEN_EXPORTS;

export const screenExportByExtension = (extension: string): ScreenExport | undefined =>
  Object.values(SCREEN_EXPORTS).find((f) => f.extension === extension);
