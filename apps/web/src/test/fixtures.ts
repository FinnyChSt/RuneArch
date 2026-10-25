import { CanvasDoc, emptyCanvas } from '@flowcanvas/shared';

/** users(id, email) and orders(id, user_id -> users.id) with the FK edge */
export function shopDoc(): CanvasDoc {
  return CanvasDoc.parse({
    ...emptyCanvas(),
    nodes: [
      {
        id: 'users',
        type: 'table',
        label: 'users',
        position: { x: 0, y: 0 },
        data: {
          columns: [
            { id: 'u_id', name: 'id', type: 'uuid', primaryKey: true, nullable: false },
            { id: 'u_email', name: 'email', type: 'text', unique: true },
          ],
        },
      },
      {
        id: 'orders',
        type: 'table',
        label: 'orders',
        position: { x: 400, y: 0 },
        data: {
          columns: [
            { id: 'o_id', name: 'id', type: 'uuid', primaryKey: true, nullable: false },
            { id: 'o_user', name: 'user_id', type: 'uuid', nullable: false },
          ],
          indexes: [{ id: 'ix', columnIds: ['o_user'] }],
        },
      },
      { id: 'get', type: 'endpoint', position: { x: 0, y: 300 }, data: { method: 'GET', path: '/orders' } },
      { id: 'post', type: 'endpoint', position: { x: 0, y: 400 }, data: { method: 'POST', path: '/orders' } },
    ],
    edges: [
      {
        id: 'fk',
        kind: 'fk',
        source: 'orders',
        target: 'users',
        data: { sourceColumnId: 'o_user', targetColumnId: 'u_id' },
      },
      { id: 'w', kind: 'writes', source: 'post', target: 'orders' },
    ],
    flows: [{ id: 'f', name: 'Order', steps: [{ edgeId: 'w' }] }],
  });
}

/** Cart screen -> POST /orders -> orders table, and the endpoint emits order.created. No flows yet. */
export function checkoutDoc(): CanvasDoc {
  return CanvasDoc.parse({
    ...emptyCanvas(),
    nodes: [
      { id: 'cart', type: 'screen', label: 'Cart', position: { x: 0, y: 0 }, data: { route: '/cart' } },
      { id: 'post', type: 'endpoint', position: { x: 300, y: 0 }, data: { method: 'POST', path: '/orders' } },
      { id: 'orders', type: 'table', label: 'orders', position: { x: 600, y: 0 }, data: {} },
      { id: 'created', type: 'job', label: 'order.created', position: { x: 600, y: 200 }, data: { trigger: 'event' } },
      { id: 'home', type: 'screen', label: 'Home', position: { x: 0, y: 300 }, data: {} },
    ],
    edges: [
      { id: 'e1', kind: 'calls', source: 'cart', target: 'post' },
      { id: 'e2', kind: 'writes', source: 'post', target: 'orders' },
      { id: 'e3', kind: 'emits', source: 'post', target: 'created' },
      { id: 'e4', kind: 'navigates', source: 'home', target: 'cart' },
    ],
  });
}

/**
 * checkoutDoc with a wireframe on the cart screen: a "Place order" button that calls POST /orders
 * (edge `click`), a "Back" link, and an image (not interactive).
 */
export function wireframedCheckoutDoc(): CanvasDoc {
  const doc = checkoutDoc();
  const wireframe = {
    device: 'desktop',
    elements: [
      { id: 'pic', kind: 'image', rect: { x: 0, y: 0, w: 4, h: 10 } },
      { id: 'back', kind: 'link', rect: { x: 0, y: 11, w: 3, h: 3 }, text: 'Back' },
      { id: 'place', kind: 'button', rect: { x: 8, y: 11, w: 4, h: 5 }, text: 'Place order', variant: 'primary' },
    ],
  };
  return CanvasDoc.parse({
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === 'cart' ? { ...n, data: { ...n.data, wireframe } } : n)),
    edges: [...doc.edges, { id: 'click', kind: 'calls', source: 'cart', target: 'post', sourceHandle: 'el:place' }],
  });
}
