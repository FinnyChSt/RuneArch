import { WIRE_COLUMNS, wireframeRows, type WireElement, type WireKind, type Wireframe } from '@flowcanvas/shared';

/*
 * Pure edits of a wireframe draft for the editor. Every result stays on the grid: x/w within the
 * 12 columns, y >= 0, sizes >= 1 cell. Rects are in grid cells (columns across, 8px rows down).
 */

type Rect = WireElement['rect'];
type Content = Pick<WireElement, 'text' | 'variant' | 'items'>;

/** Palette entries: label and the size and content a new element starts with */
export const PALETTE: Record<WireKind, { label: string; w: number; h: number } & Content> = {
  header: { label: 'Header', w: 12, h: 7, text: 'App', items: ['Home', 'Account'] },
  nav: { label: 'Navigation', w: 12, h: 6, items: ['Home', 'Products', 'About'] },
  tabs: { label: 'Tabs', w: 12, h: 5, items: ['Tab 1', 'Tab 2', 'Tab 3'] },
  heading: { label: 'Heading', w: 8, h: 5, text: 'Heading' },
  text: { label: 'Text', w: 8, h: 6, text: 'Some text that explains this part of the screen.' },
  button: { label: 'Button', w: 3, h: 5, text: 'Button', variant: 'primary' },
  link: { label: 'Link', w: 3, h: 3, text: 'Link' },
  input: { label: 'Input', w: 6, h: 5, text: 'Placeholder' },
  textarea: { label: 'Text area', w: 6, h: 10, text: 'Placeholder' },
  select: { label: 'Select', w: 6, h: 5, text: 'Choose…', items: ['Option 1', 'Option 2'] },
  checkbox: { label: 'Checkbox', w: 4, h: 3, text: 'Checkbox' },
  image: { label: 'Image', w: 4, h: 14 },
  card: { label: 'Card', w: 4, h: 10, text: 'Card' },
  list: { label: 'List', w: 12, h: 20, items: ['Item 1', 'Item 2', 'Item 3'] },
  table: { label: 'Table', w: 12, h: 17, items: ['Name', 'Status', 'Date'] },
  form: { label: 'Form', w: 12, h: 24, text: 'Form' },
  divider: { label: 'Divider', w: 12, h: 2 },
  instance: { label: 'Component', w: 12, h: 10 },
};

/** Which content fields the inspector offers for a kind */
export const EDITABLE: Record<WireKind, { text?: string; items?: string; variant?: true }> = {
  header: { text: 'Title', items: 'Links' },
  nav: { items: 'Links' },
  tabs: { items: 'Tabs' },
  heading: { text: 'Text' },
  text: { text: 'Text' },
  button: { text: 'Label', variant: true },
  link: { text: 'Label' },
  input: { text: 'Placeholder' },
  textarea: { text: 'Placeholder' },
  select: { text: 'Placeholder', items: 'Options' },
  checkbox: { text: 'Label' },
  image: {},
  card: { text: 'Title' },
  list: { items: 'Rows' },
  table: { items: 'Columns' },
  form: { text: 'Title' },
  divider: {},
  instance: {},
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Pulls a rect back onto the grid: whole cells, at least 1x1, inside the columns */
export function clampRect(rect: Rect): Rect {
  const w = clamp(Math.round(rect.w), 1, WIRE_COLUMNS);
  const h = Math.max(1, Math.round(rect.h));
  return { x: clamp(Math.round(rect.x), 0, WIRE_COLUMNS - w), y: Math.max(0, Math.round(rect.y)), w, h };
}

/** Moves by whole cells; the size never changes, the position stops at the edges */
export const moveRect = (rect: Rect, dx: number, dy: number): Rect => clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy });

/** Resize handles: sides and corners, named by compass direction */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Drags `handle` by whole cells; the opposite side stays put and the rect keeps at least one cell */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes('e')) w = clamp(w + dx, 1, WIRE_COLUMNS - x);
  if (handle.includes('w')) {
    const left = clamp(x + dx, 0, x + w - 1);
    w += x - left;
    x = left;
  }
  if (handle.includes('s')) h = Math.max(1, h + dy);
  if (handle.includes('n')) {
    const top = clamp(y + dy, 0, y + h - 1);
    h += y - top;
    y = top;
  }
  return { x, y, w, h };
}

/** Rect of a new element of `kind`: centered on `at` (a grid cell), or below everything else */
export function newRect(wf: Wireframe, kind: WireKind, at?: { x: number; y: number }): Rect {
  const { w, h } = PALETTE[kind];
  if (at) return clampRect({ x: at.x - w / 2, y: at.y - h / 2, w, h });
  const rows = wireframeRows(wf);
  return clampRect({ x: 0, y: rows === 0 ? 0 : rows + 1, w, h });
}

export function addElement(wf: Wireframe, kind: WireKind, id: string, at?: { x: number; y: number }): Wireframe {
  const { text, items, variant } = PALETTE[kind];
  const el: WireElement = { id, kind, rect: newRect(wf, kind, at), text, items: items && [...items], variant };
  return { ...wf, elements: [...wf.elements, el] };
}

/** Height (rows) an instance needs to show all of its component: the component's own height */
export const componentRows = (component: Wireframe | undefined) => Math.max(4, component ? wireframeRows(component) : 0);

/** Places a component, full width and as tall as its layout: centered on `at`, or below everything */
export function addInstance(
  wf: Wireframe,
  component: { id: string; wireframe?: Wireframe },
  id: string,
  at?: { x: number; y: number },
): Wireframe {
  const [w, h] = [WIRE_COLUMNS, componentRows(component.wireframe)];
  const rows = wireframeRows(wf);
  const rect = at ? clampRect({ x: at.x - w / 2, y: at.y - h / 2, w, h }) : { x: 0, y: rows === 0 ? 0 : rows + 1, w, h };
  return { ...wf, elements: [...wf.elements, { id, kind: 'instance', componentId: component.id, rect }] };
}

export function updateElement(wf: Wireframe, id: string, patch: Partial<Omit<WireElement, 'id'>>): Wireframe {
  return { ...wf, elements: wf.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) };
}

export const nudgeElement = (wf: Wireframe, id: string, dx: number, dy: number): Wireframe => {
  const el = wf.elements.find((e) => e.id === id);
  return el ? updateElement(wf, id, { rect: moveRect(el.rect, dx, dy) }) : wf;
};

export const removeElement = (wf: Wireframe, id: string): Wireframe => ({
  ...wf,
  elements: wf.elements.filter((el) => el.id !== id),
});

/** Copies an element right below the original (and just above it in drawing order) */
export function duplicateElement(wf: Wireframe, id: string, newId: string): Wireframe {
  const i = wf.elements.findIndex((el) => el.id === id);
  const el = wf.elements[i];
  if (!el) return wf;
  const copy = { ...el, id: newId, items: el.items && [...el.items], rect: moveRect(el.rect, 0, el.rect.h) };
  return { ...wf, elements: [...wf.elements.slice(0, i + 1), copy, ...wf.elements.slice(i + 1)] };
}

/** Drawing order: containers (forms, cards) go to the back so fields show on top of them */
export function reorderElement(wf: Wireframe, id: string, to: 'front' | 'back'): Wireframe {
  const el = wf.elements.find((e) => e.id === id);
  if (!el) return wf;
  const rest = wf.elements.filter((e) => e !== el);
  return { ...wf, elements: to === 'front' ? [...rest, el] : [el, ...rest] };
}

/** Clean-up on save: blank text becomes undefined, blank list items go */
export function tidyWireframe(wf: Wireframe): Wireframe {
  return {
    ...wf,
    elements: wf.elements.map((el) => {
      const items = el.items?.map((item) => item.trim()).filter(Boolean);
      return { ...el, text: el.text?.trim() || undefined, items: items?.length ? items : undefined };
    }),
  };
}
