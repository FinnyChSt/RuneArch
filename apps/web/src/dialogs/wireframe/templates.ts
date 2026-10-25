import { Wireframe, type WireDevice, type WireElement } from '@flowcanvas/shared';
import { newId } from '../../store/nodeFactory';

/*
 * Starter layouts for the Wireframe tab. Each one adapts to the device: on mobile, side-by-side
 * blocks stack and centered columns go full width. Rects are grid cells (12 columns, 8px rows).
 */

type Draft = Omit<WireElement, 'id'>;
type Rect = WireElement['rect'];

export type WireTemplate = { id: string; label: string; build(device: WireDevice): Draft[] };

const at = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const header = (text = 'App'): Draft => ({ kind: 'header', rect: at(0, 0, 12, 7), text, items: ['Home', 'Account'] });

type Block = { w: number; el: Omit<Draft, 'rect'> };

/**
 * Lays blocks out side by side from `left`, or stacks them on mobile at the blocks' total width.
 * Returns the elements and the next free row.
 */
function row(device: WireDevice, y: number, h: number, blocks: Block[], left = 0) {
  const stack = device === 'mobile';
  const total = blocks.reduce((sum, b) => sum + b.w, 0);
  let x = left;
  const elements = blocks.map(({ w, el }, i) => {
    const rect = stack ? at(left, y + i * (h + 1), total, h) : at(x, y, w, h);
    x += w;
    return { ...el, rect };
  });
  return { elements, next: y + (stack ? blocks.length * (h + 1) : h + 1) };
}

export const WIRE_TEMPLATES: readonly WireTemplate[] = [
  { id: 'blank', label: 'Blank', build: () => [] },
  {
    id: 'login',
    label: 'Login',
    build(device) {
      const [x, w] = device === 'mobile' ? [1, 10] : [3, 6];
      return [
        header(),
        { kind: 'heading', rect: at(x, 12, w, 5), text: 'Sign in' },
        { kind: 'input', rect: at(x, 18, w, 5), text: 'Email' },
        { kind: 'input', rect: at(x, 24, w, 5), text: 'Password' },
        { kind: 'checkbox', rect: at(x, 30, w, 3), text: 'Remember me' },
        { kind: 'button', rect: at(x, 35, w, 5), text: 'Sign in', variant: 'primary' },
        { kind: 'link', rect: at(x, 41, w, 3), text: 'Forgot password?' },
      ];
    },
  },
  {
    id: 'list',
    label: 'List',
    build: () => [
      header(),
      { kind: 'heading', rect: at(0, 9, 8, 5), text: 'Orders' },
      { kind: 'button', rect: at(8, 9, 4, 5), text: 'New', variant: 'primary' },
      { kind: 'input', rect: at(0, 15, 12, 5), text: 'Search…' },
      { kind: 'list', rect: at(0, 21, 12, 26), items: ['Order #1001', 'Order #1002', 'Order #1003', 'Order #1004', 'Order #1005'] },
    ],
  },
  {
    id: 'detail',
    label: 'Detail',
    build(device) {
      const media = row(device, 20, 16, [
        { w: 5, el: { kind: 'image' } },
        { w: 7, el: { kind: 'text', text: 'A short summary of the item, its status and the most important facts.' } },
      ]);
      const actions = row(device, media.next + 18, 5, [
        { w: 3, el: { kind: 'button', text: 'Edit', variant: 'secondary' } },
        { w: 3, el: { kind: 'button', text: 'Delete', variant: 'ghost' } },
      ]);
      return [
        header(),
        { kind: 'link', rect: at(0, 9, 4, 3), text: '← Back' },
        { kind: 'heading', rect: at(0, 13, 12, 5), text: 'Order #1001' },
        ...media.elements,
        { kind: 'table', rect: at(0, media.next, 12, 17), items: ['Item', 'Qty', 'Price'] },
        ...actions.elements,
      ];
    },
  },
  {
    id: 'form',
    label: 'Form',
    build(device) {
      // Fields sit inside the form box, one column in from each side
      const names = row(
        device,
        19,
        5,
        [
          { w: 5, el: { kind: 'input', text: 'First name' } },
          { w: 5, el: { kind: 'input', text: 'Last name' } },
        ],
        1,
      );
      const y = names.next;
      return [
        header(),
        { kind: 'heading', rect: at(0, 9, 12, 5), text: 'New order' },
        { kind: 'form', rect: at(0, 15, 12, y + 22 - 15), text: 'Details' },
        ...names.elements,
        { kind: 'select', rect: at(1, y, 10, 5), text: 'Shipping method', items: ['Standard', 'Express'] },
        { kind: 'textarea', rect: at(1, y + 6, 10, 10), text: 'Notes' },
        { kind: 'checkbox', rect: at(1, y + 17, 10, 3), text: 'Accept terms' },
        { kind: 'button', rect: at(6, y + 23, 3, 5), text: 'Cancel', variant: 'ghost' },
        { kind: 'button', rect: at(9, y + 23, 3, 5), text: 'Save', variant: 'primary' },
      ];
    },
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    build(device) {
      const cards = row(device, 20, 10, [
        { w: 4, el: { kind: 'card', text: 'Revenue' } },
        { w: 4, el: { kind: 'card', text: 'Orders' } },
        { w: 4, el: { kind: 'card', text: 'Customers' } },
      ]);
      return [
        header(),
        { kind: 'heading', rect: at(0, 9, 12, 5), text: 'Dashboard' },
        { kind: 'tabs', rect: at(0, 15, 12, 5), items: ['Overview', 'Reports', 'Settings'] },
        ...cards.elements,
        { kind: 'table', rect: at(0, cards.next, 12, 17), items: ['Customer', 'Status', 'Total'] },
      ];
    },
  },
];

/** A fresh wireframe from a template, with new element ids */
export function wireframeFromTemplate(template: WireTemplate, device: WireDevice): Wireframe {
  return Wireframe.parse({ device, elements: template.build(device).map((el) => ({ ...el, id: newId() })) });
}
