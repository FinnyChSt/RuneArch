import { z } from 'zod';

/*
 * Low-fidelity wireframes for screen nodes. Elements sit on a grid (WIRE_COLUMNS columns wide,
 * rows of WIRE_ROW_PX design pixels), so a layout keeps its shape when the device changes.
 * Elements have stable ids so edges and flows can attach to them (ARCHITECTURE.md §9, Wireframes).
 */

export const WIRE_COLUMNS = 12;
/** Height of one grid row at design scale (the device width in DEVICES) */
export const WIRE_ROW_PX = 8;

export const WireDevice = z.enum(['desktop', 'tablet', 'mobile']);

/** Design width (px) of each device frame; the grid's columns divide it */
export const DEVICES: Record<WireDevice, { label: string; width: number }> = {
  desktop: { label: 'Desktop', width: 800 },
  tablet: { label: 'Tablet', width: 560 },
  mobile: { label: 'Mobile', width: 320 },
};

export const WireKind = z.enum([
  'header',
  'nav',
  'heading',
  'text',
  'button',
  'link',
  'input',
  'textarea',
  'select',
  'checkbox',
  'image',
  'list',
  'table',
  'card',
  'tabs',
  'form',
  'divider',
  /** A placed component: its own wireframe, reflowed to this element's width */
  'instance',
]);

const GridInt = z.number().int();

export const WireElement = z.object({
  id: z.string().min(1),
  kind: WireKind,
  /** Position and size in grid cells: x/w in columns, y/h in rows */
  rect: z.object({
    x: GridInt.min(0),
    y: GridInt.min(0),
    w: GridInt.positive(),
    h: GridInt.positive(),
  }),
  /** Label, title, placeholder or body text, depending on the kind */
  text: z.string().optional(),
  /** Buttons: visual weight */
  variant: z.enum(['primary', 'secondary', 'ghost']).optional(),
  /** Nav links, list rows, table columns, tab names, select options */
  items: z.array(z.string()).optional(),
  /** Forms, lists and tables: the API model they show or submit (id in `doc.models`) */
  modelRef: z.string().min(1).optional(),
  /** Instances: the `component` node whose wireframe they show */
  componentId: z.string().min(1).optional(),
});

export const Wireframe = z
  .object({
    device: WireDevice.default('desktop'),
    elements: z.array(WireElement).default([]),
  })
  .superRefine((wf, ctx) => {
    const ids = new Set<string>();
    wf.elements.forEach((el, i) => {
      if (ids.has(el.id)) ctx.addIssue({ code: 'custom', path: ['elements', i, 'id'], message: 'Duplicate element id' });
      ids.add(el.id);
      if (el.rect.x + el.rect.w > WIRE_COLUMNS)
        ctx.addIssue({
          code: 'custom',
          path: ['elements', i, 'rect'],
          message: `Element is wider than the ${WIRE_COLUMNS}-column grid`,
        });
      if (el.kind === 'instance' && el.componentId === undefined)
        ctx.addIssue({ code: 'custom', path: ['elements', i, 'componentId'], message: 'Pick a component' });
      if (el.kind !== 'instance' && el.componentId !== undefined)
        ctx.addIssue({ code: 'custom', path: ['elements', i, 'componentId'], message: 'Only component instances name a component' });
      if (el.modelRef !== undefined && !MODEL_KINDS.includes(el.kind))
        ctx.addIssue({
          code: 'custom',
          path: ['elements', i, 'modelRef'],
          message: 'Only forms, lists and tables can show a model',
        });
    });
  });

/** Element kinds that can be bound to an API model (`modelRef`): a form submits it, a list or table shows it */
export const MODEL_KINDS: readonly WireKind[] = ['form', 'list', 'table'];

/** Element kinds a user acts on; only these can start a connection (click → endpoint or screen) */
export const INTERACTIVE_KINDS: readonly WireKind[] = ['button', 'link', 'form', 'list'];
export const isInteractive = (kind: WireKind) => INTERACTIVE_KINDS.includes(kind);

/**
 * Edges that start at a screen element store `sourceHandle: "el:<elementId>"`. The canvas renders
 * the handle per side (`el:<id>:l` / `el:<id>:r`), so parsing accepts both forms.
 */
export const elementHandleId = (elementId: string) => `el:${elementId}`;
export const elementIdOf = (handleId: string | null | undefined): string | null =>
  handleId?.startsWith('el:') ? handleId.slice(3).replace(/:[lr]$/, '') : null;

export type WireDevice = z.infer<typeof WireDevice>;
export type WireKind = z.infer<typeof WireKind>;
export type WireElement = z.infer<typeof WireElement>;
export type Wireframe = z.infer<typeof Wireframe>;

/** Height of the wireframe in grid rows: the bottom edge of its lowest element */
export const wireframeRows = (wf: Pick<Wireframe, 'elements'>): number =>
  wf.elements.reduce((rows, el) => Math.max(rows, el.rect.y + el.rect.h), 0);
